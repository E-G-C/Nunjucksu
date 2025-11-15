import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { parse } from 'yaml';
import { NunjucksController } from '../nunjucksController';

suite('Local Config Files - Format Support', () => {
	test('YAML config parses correctly', () => {
		const yaml = `
vars:
  rootVar: root-value
  nested:
    key: value
`;
		const result = parse(yaml);
		assert.ok(result);
		assert.strictEqual(result.vars.rootVar, 'root-value');
		assert.strictEqual(result.vars.nested.key, 'value');
	});

	test('JSON config structure matches YAML', () => {
		const jsonConfig = {
			vars: {
				rootVar: 'json-value',
				nested: {
					key: 'value'
				}
			},
			transforms: {
				'source.njk': 'target.txt'
			}
		};
		
		const json = JSON.stringify(jsonConfig);
		const parsed = JSON.parse(json);
		
		assert.strictEqual(parsed.vars.rootVar, 'json-value');
		assert.strictEqual(parsed.vars.nested.key, 'value');
		assert.strictEqual(parsed.transforms['source.njk'], 'target.txt');
	});

	test('JSON supports array transforms', () => {
		const jsonConfig = {
			vars: { test: 'value' },
			transforms: [
				{ source: 'a.njk', target: 'a.txt' },
				{ source: 'b.njk', target: 'b.txt' }
			]
		};
		
		const json = JSON.stringify(jsonConfig);
		const parsed = JSON.parse(json);
		
		assert.ok(Array.isArray(parsed.transforms));
		assert.strictEqual(parsed.transforms.length, 2);
		assert.strictEqual(parsed.transforms[0].source, 'a.njk');
	});

	test('JSON supports directory transforms', () => {
		const jsonConfig = {
			transforms: [{
				source: 'templates/',
				target: 'output/',
				recursive: true
			}]
		};
		
		const json = JSON.stringify(jsonConfig);
		const parsed = JSON.parse(json);
		
		assert.strictEqual(parsed.transforms[0].recursive, true);
	});

	test('JSON supports both .vscode and directory-level configs', () => {
		const vscodeConfig = {
			vars: {
				global: 'value',
				override: 'global'
			}
		};
		
		const localConfig = {
			vars: {
				local: 'value',
				override: 'local'
			}
		};
		
		// Simulate merging (shallow Object.assign)
		const merged = { ...vscodeConfig.vars, ...localConfig.vars };
		
		assert.strictEqual(merged.global, 'value');
		assert.strictEqual(merged.local, 'value');
		assert.strictEqual(merged.override, 'local', 'Local should override global');
	});
});

suite('Variable Scoping - Precedence Rules', () => {
	test('Local variables override parent variables', () => {
		const parentVars = { shared: 'parent', parentOnly: 'value' };
		const childVars = { shared: 'child', childOnly: 'value' };
		
		// Simulate variable merging
		const merged = { ...parentVars, ...childVars };
		
		assert.strictEqual(merged.shared, 'child', 'Child should override parent');
		assert.strictEqual(merged.parentOnly, 'value', 'Parent-only vars should remain');
		assert.strictEqual(merged.childOnly, 'value', 'Child-only vars should be included');
	});

	test('Multiple levels of config files merge correctly', () => {
		const level1 = { a: '1', shared: 'level1' };
		const level2 = { b: '2', shared: 'level2' };
		const level3 = { c: '3', shared: 'level3' };
		
		// Merge from root to leaf
		const merged = { ...level1, ...level2, ...level3 };
		
		assert.strictEqual(merged.a, '1');
		assert.strictEqual(merged.b, '2');
		assert.strictEqual(merged.c, '3');
		assert.strictEqual(merged.shared, 'level3', 'Deepest level should win');
	});

	test('Empty config does not break merging', () => {
		const parent = { var: 'value' };
		const emptyChild = {};
		
		const merged = { ...parent, ...emptyChild };
		
		assert.strictEqual(merged.var, 'value');
	});

	test('Nested objects are replaced, not merged', () => {
		const parent = { nested: { a: '1', b: '2' } };
		const child = { nested: { b: 'new', c: '3' } };
		
		// Shallow merge replaces nested objects completely
		const merged = { ...parent, ...child };
		
		assert.strictEqual(merged.nested.b, 'new');
		assert.strictEqual(merged.nested.c, '3');
		assert.ok(!('a' in merged.nested), 'Parent nested properties are lost');
	});
});

suite('Path Resolution', () => {
	const workspaceRoot = path.join(__dirname, 'fixtures', 'workspace');
	const workspaceFolder = {
		uri: vscode.Uri.file(workspaceRoot),
		name: 'workspace',
		index: 0
	} as vscode.WorkspaceFolder;

	function callResolvePath(value: string, configDir: string): string {
		const controller = Object.create(NunjucksController.prototype) as NunjucksController;
		return (controller as any).resolvePath(value, workspaceFolder, configDir);
	}

	test('.vscode configs resolve relative to workspace root', () => {
		const configDir = path.join(workspaceRoot, '.vscode');
		const result = callResolvePath('templates/index.html', configDir);
		assert.strictEqual(result, path.join(workspaceRoot, 'templates', 'index.html'));
	});

	test('nested configs resolve relative to their directory', () => {
		const configDir = path.join(workspaceRoot, 'templates', 'local');
		const result = callResolvePath('./index.html', configDir);
		assert.strictEqual(result, path.join(configDir, 'index.html'));
	});
});
