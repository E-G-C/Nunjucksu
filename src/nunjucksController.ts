import * as vscode from 'vscode';
import nunjucks from 'nunjucks';
import { parse } from 'yaml';
import * as path from 'path';

interface TransformSpec {
	source: string;
	target: string;
	recursive?: boolean;
}

interface FileTransformEntry {
	source: vscode.Uri;
	target: vscode.Uri;
	searchPaths: string[];
	templateName: string;
	description: string;
}

interface DirectoryTransform {
	sourceDir: string;
	targetDir: string;
	recursive: boolean;
	workspaceFolder: vscode.WorkspaceFolder | undefined;
	description: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeFsPath(fsPath: string): string {
	const normalized = path.resolve(fsPath);
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function uniquePaths(paths: string[]): string[] {
	const seen = new Set<string>();
	for (const entry of paths) {
		if (!entry) {
			continue;
		}
		seen.add(path.normalize(entry));
	}
	return Array.from(seen);
}

export class NunjucksController implements vscode.Disposable {
	private readonly output: vscode.OutputChannel;
	private readonly sourceWatchers: vscode.FileSystemWatcher[] = [];
	private readonly transformsBySource = new Map<string, FileTransformEntry[]>();
	private readonly renderQueue = new Map<string, Promise<void>>();
	private configWatcher: vscode.FileSystemWatcher | undefined;
	private templateWatcher: vscode.FileSystemWatcher | undefined;
	private transforms: FileTransformEntry[] = [];
	private configFileTransforms: FileTransformEntry[] = [];
	private directoryTransforms: DirectoryTransform[] = [];
	private templateTransforms: FileTransformEntry[] = [];
	private variables: Record<string, unknown> = {};
	private reloadPromise: Promise<void> | undefined;
	private templateReloadPromise: Promise<void> | undefined;
	private lastTemplateCount = -1;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.output = vscode.window.createOutputChannel('Nunjucksu');
		this.context.subscriptions.push(this.output);
	}

	async initialize(): Promise<void> {
		await this.reloadConfigs();
		this.setupConfigWatcher();
		this.setupTemplateWatcher();
	}

	dispose(): void {
		this.disposeSourceWatchers();
		this.configWatcher?.dispose();
		this.templateWatcher?.dispose();
		this.renderQueue.clear();
	}

	async renderAll(): Promise<void> {
		if (!this.transforms.length) {
			vscode.window.showInformationMessage('Nunjucksu: no transforms are configured.');
			return;
		}

		for (const transform of this.transforms) {
			await this.renderTransform(transform, 'manual');
		}

		vscode.window.setStatusBarMessage('Nunjucksu: rendered all templates', 2000);
	}

	private setupConfigWatcher(): void {
		if (this.configWatcher) {
			return;
		}

		const watcher = vscode.workspace.createFileSystemWatcher('**/.vscode/*.njk.yaml');
		watcher.onDidChange(() => this.reloadConfigs());
		watcher.onDidCreate(() => this.reloadConfigs());
		watcher.onDidDelete(() => this.reloadConfigs());

		this.configWatcher = watcher;
		this.context.subscriptions.push(watcher);
	}

	private setupTemplateWatcher(): void {
		if (this.templateWatcher) {
			return;
		}

		const watcher = vscode.workspace.createFileSystemWatcher('**/*.njk', false, false, false);
		const trigger = () => {
			void this.refreshTemplateTransforms();
		};

		watcher.onDidChange(trigger);
		watcher.onDidCreate(trigger);
		watcher.onDidDelete(trigger);

		this.templateWatcher = watcher;
		this.context.subscriptions.push(watcher);
	}

	private async reloadConfigs(): Promise<void> {
		if (this.reloadPromise) {
			return this.reloadPromise;
		}

		const promise = this.performReload().finally(() => {
			if (this.reloadPromise === promise) {
				this.reloadPromise = undefined;
			}
		});

		this.reloadPromise = promise;
		return promise;
	}

	private async performReload(): Promise<void> {
		const configUris = await vscode.workspace.findFiles('**/.vscode/*.njk.yaml');
		configUris.sort((a, b) => a.fsPath.localeCompare(b.fsPath, undefined, { sensitivity: 'base' }));

		const mergedVars: Record<string, unknown> = {};
		const gatheredFileTransforms: FileTransformEntry[] = [];
		const gatheredDirectoryTransforms: DirectoryTransform[] = [];

		if (!configUris.length) {
			this.output.appendLine('Nunjucksu: no .njk.yaml configuration files were found.');
		}

		for (const uri of configUris) {
			try {
				const { fileTransforms, directoryTransforms, vars } = await this.readConfig(uri);
				Object.assign(mergedVars, vars);
				gatheredFileTransforms.push(...fileTransforms);
				gatheredDirectoryTransforms.push(...directoryTransforms);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.output.appendLine(`Nunjucksu: failed to load ${uri.fsPath}: ${message}`);
				vscode.window.showWarningMessage(`Nunjucksu: unable to read ${path.basename(uri.fsPath)}. Check the output channel for details.`);
			}
		}

		this.variables = mergedVars;
		this.configFileTransforms = gatheredFileTransforms;
		this.directoryTransforms = gatheredDirectoryTransforms;

		if (configUris.length) {
			this.output.appendLine(`Nunjucksu: loaded ${gatheredFileTransforms.length} file transform(s) and ${gatheredDirectoryTransforms.length} directory transform(s) from ${configUris.length} config file(s).`);
		}

		try {
			await this.refreshTemplateTransforms();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.output.appendLine(`Nunjucksu: failed to refresh .njk templates: ${message}`);
		}
	}

	private refreshTemplateTransforms(): Promise<void> {
		if (this.templateReloadPromise) {
			return this.templateReloadPromise;
		}

		const promise = this.performTemplateReload().finally(() => {
			if (this.templateReloadPromise === promise) {
				this.templateReloadPromise = undefined;
			}
		});

		this.templateReloadPromise = promise;
		return promise;
	}

	private async performTemplateReload(): Promise<void> {
		const configTransformsBySource = new Map<string, FileTransformEntry>();
		for (const entry of this.configFileTransforms) {
			configTransformsBySource.set(normalizeFsPath(entry.source.fsPath), entry);
		}

		const directoryTransformMap = new Map<string, FileTransformEntry>();

		for (const directoryTransform of this.directoryTransforms) {
			try {
				const templates = await this.collectTemplatesFromDirectory(directoryTransform);
				for (const { uri, relative } of templates) {
					const entry = this.createDirectoryFileTransform(directoryTransform, uri, relative);
					if (!entry) {
						continue;
					}
					directoryTransformMap.set(normalizeFsPath(entry.source.fsPath), entry);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.output.appendLine(`Nunjucksu: failed to scan ${directoryTransform.sourceDir}: ${message}`);
			}
		}

		const dynamicTransforms: FileTransformEntry[] = [];
		for (const entry of directoryTransformMap.values()) {
			const key = normalizeFsPath(entry.source.fsPath);
			if (configTransformsBySource.has(key)) {
				continue;
			}
			dynamicTransforms.push(entry);
		}

		dynamicTransforms.sort((a, b) => a.source.fsPath.localeCompare(b.source.fsPath, undefined, { sensitivity: 'base' }));

		this.templateTransforms = dynamicTransforms;
		this.transforms = [...this.configFileTransforms, ...dynamicTransforms];
		this.rebuildSourceWatchers();

		if (this.lastTemplateCount !== dynamicTransforms.length) {
			this.output.appendLine(`Nunjucksu: discovered ${dynamicTransforms.length} .njk template(s) from directory transforms.`);
			this.lastTemplateCount = dynamicTransforms.length;
		}
	}

	private stripNjkExtension(value: string): string {
		return value.toLowerCase().endsWith('.njk') ? value.slice(0, -4) : value;
	}

	private async collectTemplatesFromDirectory(directoryTransform: DirectoryTransform): Promise<Array<{ uri: vscode.Uri; relative: string }>> {
		const results: Array<{ uri: vscode.Uri; relative: string }> = [];
		const rootPath = directoryTransform.sourceDir;
		await this.walkDirectoryForTemplates(rootPath, '', directoryTransform.recursive, results);
		return results;
	}

	private async walkDirectoryForTemplates(rootPath: string, relativePath: string, recursive: boolean, bucket: Array<{ uri: vscode.Uri; relative: string }>): Promise<void> {
		const currentPath = relativePath ? path.join(rootPath, relativePath) : rootPath;
		let entries: readonly [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(currentPath));
		} catch (error) {
			throw error;
		}

		for (const [name, type] of entries) {
			const childRelative = relativePath ? path.join(relativePath, name) : name;
			const childPath = path.join(currentPath, name);

			if (type === vscode.FileType.File) {
				if (name.toLowerCase().endsWith('.njk')) {
					bucket.push({ uri: vscode.Uri.file(childPath), relative: childRelative });
				}
				continue;
			}

			if (type === vscode.FileType.Directory && recursive) {
				await this.walkDirectoryForTemplates(rootPath, childRelative, recursive, bucket);
			}
		}
	}

	private createDirectoryFileTransform(directoryTransform: DirectoryTransform, uri: vscode.Uri, relative: string): FileTransformEntry | undefined {
		const normalizedRelative = path.normalize(relative);
		if (!normalizedRelative.toLowerCase().endsWith('.njk')) {
			return undefined;
		}

		if (!directoryTransform.recursive && normalizedRelative.includes(path.sep)) {
			return undefined;
		}

		const outputRelative = this.stripNjkExtension(normalizedRelative);
		const targetPath = path.join(directoryTransform.targetDir, outputRelative);
		const spec: TransformSpec = { source: uri.fsPath, target: targetPath };
		const entry = this.createFileTransformEntry(spec, directoryTransform.workspaceFolder, directoryTransform.sourceDir);
		if (entry) {
			entry.description = `${directoryTransform.description} :: ${normalizedRelative}`;
		}
		return entry;
	}

	private async readConfig(uri: vscode.Uri): Promise<{ vars: Record<string, unknown>; fileTransforms: FileTransformEntry[]; directoryTransforms: DirectoryTransform[]; }> {
		const bytes = await vscode.workspace.fs.readFile(uri);
		const text = Buffer.from(bytes).toString('utf8');
		const parsed = parse(text) ?? {};

		if (!isPlainObject(parsed)) {
			throw new Error('Configuration root must be a mapping.');
		}

		const vars = this.extractVars(parsed.vars);
		const specs = this.extractTransformSpecs(parsed.transforms, uri.fsPath);

		const configDir = path.dirname(uri.fsPath);
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];

		const fileTransforms: FileTransformEntry[] = [];
		const directoryTransforms: DirectoryTransform[] = [];

		for (const spec of specs) {
			if (typeof spec.recursive === 'boolean') {
				const directoryEntry = this.createDirectoryTransform(spec, workspaceFolder, configDir);
				if (directoryEntry) {
					directoryTransforms.push(directoryEntry);
				}
				continue;
			}

			const entry = this.createFileTransformEntry(spec, workspaceFolder, configDir);
			if (entry) {
				fileTransforms.push(entry);
			}
		}

		return { vars, fileTransforms, directoryTransforms };
	}

	private extractVars(raw: unknown): Record<string, unknown> {
		if (!isPlainObject(raw)) {
			return {};
		}
		return { ...raw };
	}

	private extractTransformSpecs(raw: unknown, configPath: string): TransformSpec[] {
		const specs: TransformSpec[] = [];

		if (!raw) {
			return specs;
		}

		if (Array.isArray(raw)) {
			for (const entry of raw) {
				const normalized = this.normalizeTransform(entry);
				if (normalized) {
					specs.push(normalized);
				} else {
					this.output.appendLine(`Nunjucksu: skipped invalid transform entry in ${configPath}.`);
				}
			}
			return specs;
		}

		if (isPlainObject(raw)) {
			const record = raw as Record<string, unknown>;
			const singleSource = this.coercePath(record.source);
			const singleTarget = this.coercePath(record.target);
			if (singleSource && singleTarget) {
				const recursive = typeof record.recursive === 'boolean' ? record.recursive : undefined;
				specs.push({ source: singleSource, target: singleTarget, recursive });
				return specs;
			}

			for (const [sourceKey, targetSpec] of Object.entries(record)) {
				const directTarget = this.coercePath(targetSpec);
				if (directTarget) {
					specs.push({ source: sourceKey, target: directTarget });
					continue;
				}

				if (isPlainObject(targetSpec)) {
					const transformRecord = targetSpec as Record<string, unknown>;
					const targetPath = this.coercePath(transformRecord.target);
					if (targetPath) {
						const candidateSource = this.coercePath(transformRecord.source) ?? sourceKey;
						const recursive = typeof transformRecord.recursive === 'boolean' ? transformRecord.recursive : undefined;
						specs.push({ source: candidateSource, target: targetPath, recursive });
						continue;
					}
				}

				this.output.appendLine(`Nunjucksu: transform '${sourceKey}' in ${configPath} is invalid and was ignored.`);
			}

			return specs;
		}

		this.output.appendLine(`Nunjucksu: transforms section in ${configPath} must be an array or mapping.`);
		return specs;
	}

	private normalizeTransform(entry: unknown): TransformSpec | undefined {
		if (!isPlainObject(entry)) {
			return undefined;
		}

		const source = this.coercePath(entry.source);
		const target = this.coercePath(entry.target);
		const recursive = typeof entry.recursive === 'boolean' ? entry.recursive : undefined;

		if (!source || !target) {
			return undefined;
		}

		return { source, target, recursive };
	}

	private coercePath(value: unknown): string | undefined {
		if (typeof value === 'string') {
			return value;
		}

		if (typeof value === 'number' && Number.isFinite(value)) {
			return String(value);
		}

		if (typeof value === 'bigint') {
			return value.toString();
		}

		if (value instanceof vscode.Uri) {
			return value.fsPath;
		}

		return undefined;
	}

	private createFileTransformEntry(spec: TransformSpec, workspaceFolder: vscode.WorkspaceFolder | undefined, configDir: string): FileTransformEntry | undefined {
		const sourcePath = this.resolvePath(spec.source, workspaceFolder, configDir);
		const targetPath = this.resolvePath(spec.target, workspaceFolder, configDir);

		if (!sourcePath || !targetPath) {
			return undefined;
		}

		if (normalizeFsPath(sourcePath) === normalizeFsPath(targetPath)) {
			this.output.appendLine(`Nunjucksu: skipped transform where source and target are the same path (${spec.source}).`);
			return undefined;
		}

		const searchPaths = this.buildSearchPaths(sourcePath, workspaceFolder);
		const templateName = this.deriveTemplateName(sourcePath, searchPaths);
		const description = `${spec.source} → ${spec.target}`;

		return {
			source: vscode.Uri.file(sourcePath),
			target: vscode.Uri.file(targetPath),
			searchPaths,
			templateName,
			description
		};
	}

	private createDirectoryTransform(spec: TransformSpec, workspaceFolder: vscode.WorkspaceFolder | undefined, configDir: string): DirectoryTransform | undefined {
		const sourceDir = this.resolvePath(spec.source, workspaceFolder, configDir);
		const targetDir = this.resolvePath(spec.target, workspaceFolder, configDir);

		if (!sourceDir || !targetDir) {
			return undefined;
		}

		const recursive = spec.recursive ?? false;
		const description = `${spec.source} → ${spec.target}${recursive ? ' (recursive)' : ''}`;
		return {
			sourceDir: path.normalize(sourceDir),
			targetDir: path.normalize(targetDir),
			recursive,
			workspaceFolder,
			description
		};
	}

	private resolvePath(value: string, workspaceFolder: vscode.WorkspaceFolder | undefined, configDir: string): string {
		if (path.isAbsolute(value)) {
			return path.normalize(value);
		}

		const base = workspaceFolder?.uri.fsPath ?? configDir;
		return path.normalize(path.resolve(base, value));
	}

	private buildSearchPaths(sourcePath: string, workspaceFolder: vscode.WorkspaceFolder | undefined): string[] {
		const paths = [path.dirname(sourcePath)];
		if (workspaceFolder) {
			paths.push(workspaceFolder.uri.fsPath);
		}
		return uniquePaths(paths);
	}

	private deriveTemplateName(sourcePath: string, searchPaths: string[]): string {
		for (const base of searchPaths) {
			const relative = path.relative(base, sourcePath);
			if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
				return relative.split(path.sep).join('/');
			}
		}

		return path.basename(sourcePath);
	}

	private rebuildSourceWatchers(): void {
		this.disposeSourceWatchers();
		this.transformsBySource.clear();

		for (const transform of this.transforms) {
			const key = normalizeFsPath(transform.source.fsPath);
			const existing = this.transformsBySource.get(key);
			if (existing) {
				existing.push(transform);
			} else {
				this.transformsBySource.set(key, [transform]);
			}
		}

		for (const entries of this.transformsBySource.values()) {
			const watcher = this.createWatcher(entries[0].source);
			this.sourceWatchers.push(watcher);

			watcher.onDidChange(uri => this.handleSourceEvent(uri, 'change'));
			watcher.onDidCreate(uri => this.handleSourceEvent(uri, 'create'));
		}
	}

	private createWatcher(source: vscode.Uri): vscode.FileSystemWatcher {
		const folder = vscode.workspace.getWorkspaceFolder(source);

		if (folder) {
			const relativePath = path.relative(folder.uri.fsPath, source.fsPath).split(path.sep).join('/');
			const pattern = new vscode.RelativePattern(folder, relativePath);
			return vscode.workspace.createFileSystemWatcher(pattern);
		}

		const baseDir = path.dirname(source.fsPath);
		const pattern = new vscode.RelativePattern(vscode.Uri.file(baseDir), path.basename(source.fsPath));
		return vscode.workspace.createFileSystemWatcher(pattern);
	}

	private disposeSourceWatchers(): void {
		while (this.sourceWatchers.length) {
			const watcher = this.sourceWatchers.pop();
			watcher?.dispose();
		}
	}

	private handleSourceEvent(uri: vscode.Uri, reason: 'change' | 'create'): void {
		const key = normalizeFsPath(uri.fsPath);
		const transforms = this.transformsBySource.get(key);

		if (!transforms?.length) {
			return;
		}

		const run = async () => {
			for (const transform of transforms) {
				await this.renderTransform(transform, reason);
			}
		};

		const previous = this.renderQueue.get(key) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(run).finally(() => {
			if (this.renderQueue.get(key) === next) {
				this.renderQueue.delete(key);
			}
		});

		this.renderQueue.set(key, next);
	}

	private async renderTransform(transform: FileTransformEntry, reason: string): Promise<void> {
		try {
			const output = await this.renderTemplate(transform);
			await this.writeTarget(transform.target, output);
			this.output.appendLine(`Nunjucksu: rendered ${transform.description} (${reason}).`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.output.appendLine(`Nunjucksu: failed to render ${transform.description}: ${message}`);
			vscode.window.showWarningMessage(`Nunjucksu: failed to render ${path.basename(transform.target.fsPath)}. See output for details.`);
		}
	}

	private renderTemplate(transform: FileTransformEntry): Promise<string> {
		const loader = new nunjucks.FileSystemLoader(transform.searchPaths, { noCache: true, watch: false });
		const environment = new nunjucks.Environment(loader, { autoescape: false });
		const context = { ...this.variables };

		return new Promise((resolve, reject) => {
			environment.render(transform.templateName, context, (err, result) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(result ?? '');
			});
		});
	}

	private async writeTarget(uri: vscode.Uri, contents: string): Promise<void> {
		const directory = path.dirname(uri.fsPath);
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(directory));

		const next = Buffer.from(contents, 'utf8');
		try {
			const current = await vscode.workspace.fs.readFile(uri);
			if (Buffer.compare(Buffer.from(current), next) === 0) {
				return;
			}
		} catch (error) {
			// Ignore missing file errors; the file will be created below.
		}

		await vscode.workspace.fs.writeFile(uri, next);
	}
}
