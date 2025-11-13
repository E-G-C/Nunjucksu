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

const RENDER_TIMEOUT_MS = 30000; // 30 seconds

export class NunjucksController implements vscode.Disposable {
	private readonly output: vscode.OutputChannel;
	private readonly sourceWatchers: vscode.FileSystemWatcher[] = [];
	private readonly transformsBySource = new Map<string, FileTransformEntry[]>();
	private readonly renderQueue = new Map<string, Promise<void>>();
	private readonly renderTimestamps = new Map<string, number>();
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
		
		// Periodically clean up stale render queue entries
		const cleanupInterval = setInterval(() => this.cleanupStaleRenders(), 60000);
		this.context.subscriptions.push({ dispose: () => clearInterval(cleanupInterval) });
	}

	async initialize(): Promise<void> {
		await this.reloadConfigs();
		this.setupConfigWatcher();
		this.setupTemplateWatcher();
	}

	private getLogLevel(): 'silent' | 'normal' | 'verbose' {
		const config = vscode.workspace.getConfiguration('nunjucksu');
		return config.get<'silent' | 'normal' | 'verbose'>('logLevel', 'normal');
	}

	private getTemplateExtension(): string {
		const config = vscode.workspace.getConfiguration('nunjucksu');
		return config.get<string>('templateExtension', '.njk');
	}

	private getAdditionalSearchPaths(): string[] {
		const config = vscode.workspace.getConfiguration('nunjucksu');
		return config.get<string[]>('additionalSearchPaths', []);
	}

	private log(message: string, level: 'normal' | 'verbose' = 'normal'): void {
		const currentLevel = this.getLogLevel();
		if (currentLevel === 'silent') {
			return;
		}
		if (level === 'verbose' && currentLevel !== 'verbose') {
			return;
		}
		this.output.appendLine(message);
	}

	dispose(): void {
		this.disposeSourceWatchers();
		this.configWatcher?.dispose();
		this.templateWatcher?.dispose();
		this.renderQueue.clear();
		this.renderTimestamps.clear();
	}

	private cleanupStaleRenders(): void {
		const now = Date.now();
		const staleKeys: string[] = [];
		
		for (const [key, timestamp] of this.renderTimestamps.entries()) {
			if (now - timestamp > RENDER_TIMEOUT_MS) {
				staleKeys.push(key);
			}
		}
		
		for (const key of staleKeys) {
			this.renderQueue.delete(key);
			this.renderTimestamps.delete(key);
			this.log(`Nunjucksu: cleaned up stale render for ${key}`, 'verbose');
		}
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

		const ext = this.getTemplateExtension();
		const pattern = ext.startsWith('.') ? `**/*${ext}` : `**/*.${ext}`;
		const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, false);

		// Use incremental updates instead of full rescans
		watcher.onDidChange(uri => this.handleTemplateChange(uri));
		watcher.onDidCreate(uri => this.handleTemplateChange(uri));
		watcher.onDidDelete(uri => this.handleTemplateDelete(uri));

		this.templateWatcher = watcher;
		this.context.subscriptions.push(watcher);
	}

	private handleTemplateChange(uri: vscode.Uri): void {
		// For large projects, only check if this specific template should be added/updated
		const key = normalizeFsPath(uri.fsPath);
		
		// Check if this template is part of a directory transform
		for (const dirTransform of this.directoryTransforms) {
			const relativePath = path.relative(dirTransform.sourceDir, uri.fsPath);
			
			if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
				const entry = this.createDirectoryFileTransform(dirTransform, uri, relativePath);
				if (entry) {
					// Update or add this single template
					const existingIndex = this.templateTransforms.findIndex(t => 
						normalizeFsPath(t.source.fsPath) === key
					);
					
					if (existingIndex >= 0) {
						this.templateTransforms[existingIndex] = entry;
					} else {
						this.templateTransforms.push(entry);
					}
					
					this.rebuildTransformsList();
					this.rebuildSourceWatchers();
					return;
				}
			}
		}
	}

	private handleTemplateDelete(uri: vscode.Uri): void {
		const key = normalizeFsPath(uri.fsPath);
		const initialLength = this.templateTransforms.length;
		
		this.templateTransforms = this.templateTransforms.filter(t => 
			normalizeFsPath(t.source.fsPath) !== key
		);
		
		if (this.templateTransforms.length !== initialLength) {
			this.rebuildTransformsList();
			this.rebuildSourceWatchers();
		}
	}

	private rebuildTransformsList(): void {
		const configBySource = new Map<string, FileTransformEntry>();
		for (const entry of this.configFileTransforms) {
			configBySource.set(normalizeFsPath(entry.source.fsPath), entry);
		}

		const templateBySource = new Map<string, FileTransformEntry>();
		for (const entry of this.templateTransforms) {
			const key = normalizeFsPath(entry.source.fsPath);
			if (!configBySource.has(key)) {
				templateBySource.set(key, entry);
			}
		}

		this.transforms = [...this.configFileTransforms, ...templateBySource.values()];
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
			this.log('Nunjucksu: no .njk.yaml configuration files were found.', 'verbose');
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

		// Detect cycles in transform graph
		const filteredTransforms = this.detectAndRemoveCycles(gatheredFileTransforms);

		this.variables = mergedVars;
		this.configFileTransforms = filteredTransforms;
		this.directoryTransforms = gatheredDirectoryTransforms;

		if (configUris.length) {
			this.log(`Nunjucksu: loaded ${gatheredFileTransforms.length} file transform(s) and ${gatheredDirectoryTransforms.length} directory transform(s) from ${configUris.length} config file(s).`, 'verbose');
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
		// Snapshot to avoid race condition if configFileTransforms changes during async operations
		const snapshotConfigTransforms = [...this.configFileTransforms];
		
		const configTransformsBySource = new Map<string, FileTransformEntry>();
		for (const entry of snapshotConfigTransforms) {
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
				vscode.window.showWarningMessage(`Nunjucksu: cannot access directory ${path.basename(directoryTransform.sourceDir)}. Check permissions.`);
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
		this.rebuildTransformsList();
		this.rebuildSourceWatchers();

		if (this.lastTemplateCount !== dynamicTransforms.length) {
			this.output.appendLine(`Nunjucksu: discovered ${dynamicTransforms.length} .njk template(s) from directory transforms.`);
			this.lastTemplateCount = dynamicTransforms.length;
		}
	}

	private stripNjkExtension(value: string): string {
		const ext = this.getTemplateExtension();
		return value.toLowerCase().endsWith(ext.toLowerCase()) ? value.slice(0, -ext.length) : value;
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
				const ext = this.getTemplateExtension();
				if (name.toLowerCase().endsWith(ext.toLowerCase())) {
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
		const ext = this.getTemplateExtension();
		if (!normalizedRelative.toLowerCase().endsWith(ext.toLowerCase())) {
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

		// Validate source file exists
		try {
			const fs = require('fs');
			if (!fs.existsSync(sourcePath)) {
				this.output.appendLine(`Nunjucksu: warning - source file does not exist: ${spec.source}`);
				vscode.window.showWarningMessage(`Nunjucksu: source file not found: ${path.basename(sourcePath)}`);
				return undefined;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.output.appendLine(`Nunjucksu: failed to validate source path ${spec.source}: ${message}`);
			return undefined;
		}

		if (normalizeFsPath(sourcePath) === normalizeFsPath(targetPath)) {
			this.output.appendLine(`Nunjucksu: skipped transform where source and target are the same path (${spec.source}).`);
			return undefined;
		}

		const searchPaths = this.buildSearchPaths(sourcePath, workspaceFolder);
		const templateName = this.deriveTemplateName(sourcePath, searchPaths);
		
		if (!templateName || templateName.trim() === '') {
			this.output.appendLine(`Nunjucksu: could not derive template name for ${spec.source}`);
			return undefined;
		}
		
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
		
		// Add user-configured search paths
		const additionalPaths = this.getAdditionalSearchPaths();
		for (const additionalPath of additionalPaths) {
			const resolved = workspaceFolder 
				? path.resolve(workspaceFolder.uri.fsPath, additionalPath)
				: path.resolve(additionalPath);
			paths.push(resolved);
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
		const next = previous.catch(() => undefined).then(run).catch(error => {
			const message = error instanceof Error ? error.message : String(error);
			this.output.appendLine(`Nunjucksu: unhandled error in render queue for ${key}: ${message}`);
		}).finally(() => {
			if (this.renderQueue.get(key) === next) {
				this.renderQueue.delete(key);
				this.renderTimestamps.delete(key);
			}
		});

		this.renderQueue.set(key, next);
		this.renderTimestamps.set(key, Date.now());
	}

	private async renderTransform(transform: FileTransformEntry, reason: string): Promise<void> {
		try {
			const output = await this.renderTemplate(transform);
			await this.writeTarget(transform.target, output);
			this.log(`Nunjucksu: rendered ${transform.description} (${reason}).`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.output.appendLine(`Nunjucksu: failed to render ${transform.description}: ${message}`);
			vscode.window.showWarningMessage(`Nunjucksu: failed to render ${path.basename(transform.target.fsPath)}. See output for details.`);
		}
	}

	private detectAndRemoveCycles(transforms: FileTransformEntry[]): FileTransformEntry[] {
		const graph = new Map<string, string[]>();
		
		// Build adjacency list: source -> targets
		for (const transform of transforms) {
			const sourceKey = normalizeFsPath(transform.source.fsPath);
			const targetKey = normalizeFsPath(transform.target.fsPath);
			
			if (!graph.has(sourceKey)) {
				graph.set(sourceKey, []);
			}
			graph.get(sourceKey)!.push(targetKey);
		}

		// Detect cycles using DFS
		const visited = new Set<string>();
		const recursionStack = new Set<string>();
		const cycleNodes = new Set<string>();

		const hasCycle = (node: string): boolean => {
			if (recursionStack.has(node)) {
				cycleNodes.add(node);
				return true;
			}
			if (visited.has(node)) {
				return false;
			}

			visited.add(node);
			recursionStack.add(node);

			const neighbors = graph.get(node) ?? [];
			for (const neighbor of neighbors) {
				if (hasCycle(neighbor)) {
					cycleNodes.add(node);
					return true;
				}
			}

			recursionStack.delete(node);
			return false;
		};

		// Check all nodes for cycles
		for (const node of graph.keys()) {
			hasCycle(node);
		}

		// Filter out transforms involved in cycles
		const filtered = transforms.filter(transform => {
			const sourceKey = normalizeFsPath(transform.source.fsPath);
			const targetKey = normalizeFsPath(transform.target.fsPath);
			
			if (cycleNodes.has(sourceKey) || cycleNodes.has(targetKey)) {
				this.output.appendLine(`Nunjucksu: removed transform ${transform.description} (part of cycle)`);
				vscode.window.showWarningMessage(`Nunjucksu: cycle detected in transforms involving ${path.basename(transform.source.fsPath)}`);
				return false;
			}
			return true;
		});

		return filtered;
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
