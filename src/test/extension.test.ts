import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

// Helper functions for path normalization testing
function normalizeFsPath(fsPath: string): string {
	const normalized = path.resolve(fsPath);
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function stripExtension(filename: string, ext: string): string {
	return filename.toLowerCase().endsWith(ext.toLowerCase()) 
		? filename.slice(0, -ext.length) 
		: filename;
}

suite('Nunjucksu Extension Test Suite', () => {
	vscode.window.showInformationMessage('Starting Nunjucksu tests.');

	suite('Path Normalization', () => {
		test('normalizeFsPath resolves relative paths', () => {
			const result = normalizeFsPath('./test.txt');
			assert.ok(path.isAbsolute(result), 'Should return absolute path');
		});

		test('normalizeFsPath handles absolute paths', () => {
			const input = '/Users/test/file.txt';
			const result = normalizeFsPath(input);
			assert.ok(path.isAbsolute(result), 'Should remain absolute');
		});

		test('normalizeFsPath lowercases on Windows', () => {
			if (process.platform === 'win32') {
				const result = normalizeFsPath('C:\\Users\\Test');
				assert.strictEqual(result, result.toLowerCase(), 'Should be lowercase on Windows');
			}
		});
	});

	suite('Template Extension Handling', () => {
		test('stripExtension removes .njk extension', () => {
			assert.strictEqual(stripExtension('readme.md.njk', '.njk'), 'readme.md');
		});

		test('stripExtension removes .nunjucks extension', () => {
			assert.strictEqual(stripExtension('page.html.nunjucks', '.nunjucks'), 'page.html');
		});

		test('stripExtension is case insensitive', () => {
			assert.strictEqual(stripExtension('File.NJK', '.njk'), 'File');
		});

		test('stripExtension returns original if no match', () => {
			assert.strictEqual(stripExtension('file.txt', '.njk'), 'file.txt');
		});
	});

	suite('Configuration Settings', () => {
		test('Extension contributes settings', async () => {
			const config = vscode.workspace.getConfiguration('nunjucksu');
			
			// Check that settings exist (will have default values)
			const logLevel = config.get('logLevel');
			const templateExtension = config.get('templateExtension');
			const additionalPaths = config.get('additionalSearchPaths');
			
			assert.ok(logLevel !== undefined, 'logLevel setting should exist');
			assert.ok(templateExtension !== undefined, 'templateExtension setting should exist');
			assert.ok(Array.isArray(additionalPaths), 'additionalSearchPaths should be an array');
		});

		test('Default settings have expected values', () => {
			const config = vscode.workspace.getConfiguration('nunjucksu');
			
			assert.strictEqual(config.get('logLevel'), 'normal');
			assert.strictEqual(config.get('templateExtension'), '.njk');
			assert.deepStrictEqual(config.get('additionalSearchPaths'), []);
		});
	});

	suite('Extension Activation', () => {
		test('Extension should be present', () => {
			assert.ok(vscode.extensions.getExtension('undefined_publisher.nunjucksu'));
		});

		test('Extension activates', async function() {
			this.timeout(5000);
			const ext = vscode.extensions.getExtension('undefined_publisher.nunjucksu');
			await ext?.activate();
			assert.ok(ext?.isActive, 'Extension should be active');
		});

		test('renderAll command is registered', async () => {
			const commands = await vscode.commands.getCommands(true);
			assert.ok(commands.includes('nunjucksu.renderAll'), 'renderAll command should be registered');
		});
	});
});
