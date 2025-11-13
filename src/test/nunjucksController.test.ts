import * as assert from 'assert';
import * as path from 'path';

// Unit tests for NunjucksController utility functions
// These can be extracted and tested independently

suite('NunjucksController Utilities', () => {
	suite('Path Utilities', () => {
		function normalizeFsPath(fsPath: string): string {
			const normalized = path.resolve(fsPath);
			return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
		}

		test('normalizeFsPath resolves relative paths to absolute', () => {
			const result = normalizeFsPath('./test.txt');
			assert.ok(path.isAbsolute(result));
		});

		test('normalizeFsPath handles already absolute paths', () => {
			const input = path.resolve('/tmp/test.txt');
			const result = normalizeFsPath(input);
			assert.strictEqual(path.normalize(input), path.normalize(result));
		});

		test('normalizeFsPath is case-sensitive on Unix', () => {
			if (process.platform !== 'win32') {
				const result1 = normalizeFsPath('/tmp/TEST');
				const result2 = normalizeFsPath('/tmp/test');
				assert.notStrictEqual(result1, result2);
			}
		});

		test('normalizeFsPath is case-insensitive on Windows', () => {
			if (process.platform === 'win32') {
				const result1 = normalizeFsPath('C:\\Test');
				const result2 = normalizeFsPath('C:\\test');
				assert.strictEqual(result1, result2);
			}
		});

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

		test('uniquePaths removes duplicates', () => {
			const result = uniquePaths(['/tmp/a', '/tmp/a', '/tmp/b']);
			assert.strictEqual(result.length, 2);
		});

		test('uniquePaths normalizes paths before deduping', () => {
			const result = uniquePaths(['/tmp/./a', '/tmp/a']);
			assert.strictEqual(result.length, 1);
		});

		test('uniquePaths filters out empty strings', () => {
			const result = uniquePaths(['', '/tmp/a', '', '/tmp/b']);
			assert.strictEqual(result.length, 2);
		});

		test('uniquePaths preserves order of first occurrence', () => {
			const result = uniquePaths(['/tmp/b', '/tmp/a', '/tmp/b']);
			assert.strictEqual(result[0], path.normalize('/tmp/b'));
			assert.strictEqual(result[1], path.normalize('/tmp/a'));
		});
	});

	suite('Extension Stripping', () => {
		function stripExtension(filename: string, ext: string): string {
			return filename.toLowerCase().endsWith(ext.toLowerCase()) 
				? filename.slice(0, -ext.length) 
				: filename;
		}

		test('stripExtension removes .njk', () => {
			assert.strictEqual(stripExtension('file.md.njk', '.njk'), 'file.md');
		});

		test('stripExtension removes .nunjucks', () => {
			assert.strictEqual(stripExtension('page.html.nunjucks', '.nunjucks'), 'page.html');
		});

		test('stripExtension is case-insensitive', () => {
			assert.strictEqual(stripExtension('File.NJK', '.njk'), 'File');
			assert.strictEqual(stripExtension('File.njk', '.NJK'), 'File');
		});

		test('stripExtension preserves path separators', () => {
			assert.strictEqual(stripExtension('path/to/file.njk', '.njk'), 'path/to/file');
		});

		test('stripExtension returns unchanged if no match', () => {
			assert.strictEqual(stripExtension('file.txt', '.njk'), 'file.txt');
		});

		test('stripExtension handles files with multiple dots', () => {
			assert.strictEqual(stripExtension('my.config.yaml.njk', '.njk'), 'my.config.yaml');
		});

		test('stripExtension handles extension-only filenames', () => {
			assert.strictEqual(stripExtension('.njk', '.njk'), '');
		});
	});

	suite('Object Type Checking', () => {
		function isPlainObject(value: unknown): value is Record<string, unknown> {
			return typeof value === 'object' && value !== null && !Array.isArray(value);
		}

		test('isPlainObject returns true for plain objects', () => {
			assert.ok(isPlainObject({}));
			assert.ok(isPlainObject({ a: 1 }));
		});

		test('isPlainObject returns false for null', () => {
			assert.ok(!isPlainObject(null));
		});

		test('isPlainObject returns false for arrays', () => {
			assert.ok(!isPlainObject([]));
			assert.ok(!isPlainObject([1, 2, 3]));
		});

		test('isPlainObject returns false for primitives', () => {
			assert.ok(!isPlainObject('string'));
			assert.ok(!isPlainObject(123));
			assert.ok(!isPlainObject(true));
			assert.ok(!isPlainObject(undefined));
		});

		test('isPlainObject returns true for nested objects', () => {
			assert.ok(isPlainObject({ nested: { deep: true } }));
		});
	});

	suite('Cycle Detection Algorithm', () => {
		// Simplified version of the cycle detection logic
		function detectCycles(edges: Array<[string, string]>): Set<string> {
			const graph = new Map<string, string[]>();
			
			for (const [from, to] of edges) {
				if (!graph.has(from)) {
					graph.set(from, []);
				}
				graph.get(from)!.push(to);
			}

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

			for (const node of graph.keys()) {
				hasCycle(node);
			}

			return cycleNodes;
		}

		test('detectCycles finds simple cycle', () => {
			const edges: Array<[string, string]> = [['A', 'B'], ['B', 'A']];
			const cycles = detectCycles(edges);
			assert.ok(cycles.has('A'));
			assert.ok(cycles.has('B'));
		});

		test('detectCycles finds no cycle in linear chain', () => {
			const edges: Array<[string, string]> = [['A', 'B'], ['B', 'C']];
			const cycles = detectCycles(edges);
			assert.strictEqual(cycles.size, 0);
		});

		test('detectCycles finds three-node cycle', () => {
			const edges: Array<[string, string]> = [['A', 'B'], ['B', 'C'], ['C', 'A']];
			const cycles = detectCycles(edges);
			assert.ok(cycles.has('A'));
			assert.ok(cycles.has('B'));
			assert.ok(cycles.has('C'));
		});

		test('detectCycles handles self-loop', () => {
			const edges: Array<[string, string]> = [['A', 'A']];
			const cycles = detectCycles(edges);
			assert.ok(cycles.has('A'));
		});

		test('detectCycles handles disconnected graph', () => {
			const edges: Array<[string, string]> = [['A', 'B'], ['C', 'D']];
			const cycles = detectCycles(edges);
			assert.strictEqual(cycles.size, 0);
		});

		test('detectCycles finds cycle in complex graph', () => {
			const edges: Array<[string, string]> = [
				['A', 'B'],
				['B', 'C'],
				['C', 'D'],
				['D', 'B'], // Cycle: B -> C -> D -> B
				['A', 'E']
			];
			const cycles = detectCycles(edges);
			assert.ok(cycles.has('B'));
			assert.ok(cycles.has('C'));
			assert.ok(cycles.has('D'));
			assert.ok(!cycles.has('A'));
			assert.ok(!cycles.has('E'));
		});
	});

	suite('Path Resolution Logic', () => {
		function resolvePath(value: string, workspacePath: string | undefined, configDir: string): string {
			if (path.isAbsolute(value)) {
				return path.normalize(value);
			}

			const base = workspacePath ?? configDir;
			return path.normalize(path.resolve(base, value));
		}

		test('resolvePath handles absolute paths', () => {
			const result = resolvePath('/tmp/file.txt', '/workspace', '/config');
			assert.strictEqual(path.normalize('/tmp/file.txt'), result);
		});

		test('resolvePath resolves relative to workspace when available', () => {
			const result = resolvePath('src/file.txt', '/workspace', '/config');
			assert.strictEqual(path.normalize('/workspace/src/file.txt'), result);
		});

		test('resolvePath resolves relative to config dir when no workspace', () => {
			const result = resolvePath('src/file.txt', undefined, '/config');
			assert.strictEqual(path.normalize('/config/src/file.txt'), result);
		});

		test('resolvePath handles parent directory references', () => {
			const result = resolvePath('../file.txt', '/workspace/sub', '/config');
			assert.strictEqual(path.normalize('/workspace/file.txt'), result);
		});

		test('resolvePath handles current directory references', () => {
			const result = resolvePath('./file.txt', '/workspace', '/config');
			assert.strictEqual(path.normalize('/workspace/file.txt'), result);
		});
	});
});
