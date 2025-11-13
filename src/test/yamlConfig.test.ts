import * as assert from 'assert';
import { parse } from 'yaml';

suite('YAML Configuration Parsing', () => {
	suite('Valid Configurations', () => {
		test('parses simple vars section', () => {
			const yaml = `
vars:
  title: My Project
  version: 1.0
`;
			const result = parse(yaml);
			assert.ok(result);
			assert.strictEqual(result.vars.title, 'My Project');
			assert.strictEqual(result.vars.version, 1.0);
		});

		test('parses nested vars', () => {
			const yaml = `
vars:
  author:
    name: Alice
    email: alice@example.com
`;
			const result = parse(yaml);
			assert.ok(result.vars.author);
			assert.strictEqual(result.vars.author.name, 'Alice');
			assert.strictEqual(result.vars.author.email, 'alice@example.com');
		});

		test('parses transforms as object mapping', () => {
			const yaml = `
transforms:
  src/template.njk: output/result.txt
  src/another.njk: output/another.txt
`;
			const result = parse(yaml);
			assert.ok(result.transforms);
			assert.strictEqual(result.transforms['src/template.njk'], 'output/result.txt');
		});

		test('parses transforms as array of objects', () => {
			const yaml = `
transforms:
  - source: src/template.njk
    target: output/result.txt
  - source: src/another.njk
    target: output/another.txt
`;
			const result = parse(yaml);
			assert.ok(Array.isArray(result.transforms));
			assert.strictEqual(result.transforms.length, 2);
			assert.strictEqual(result.transforms[0].source, 'src/template.njk');
			assert.strictEqual(result.transforms[0].target, 'output/result.txt');
		});

		test('parses directory transform with recursive flag', () => {
			const yaml = `
transforms:
  - source: templates/
    target: output/
    recursive: true
`;
			const result = parse(yaml);
			assert.ok(Array.isArray(result.transforms));
			assert.strictEqual(result.transforms[0].recursive, true);
		});

		test('parses single transform object', () => {
			const yaml = `
transforms:
  source: src/template.njk
  target: output/result.txt
`;
			const result = parse(yaml);
			assert.ok(result.transforms);
			assert.strictEqual(result.transforms.source, 'src/template.njk');
			assert.strictEqual(result.transforms.target, 'output/result.txt');
		});

		test('handles empty vars section', () => {
			const yaml = `
vars:
transforms:
  - source: template.njk
    target: output.txt
`;
			const result = parse(yaml);
			assert.ok(result.vars === null || typeof result.vars === 'object');
		});

		test('handles empty transforms section', () => {
			const yaml = `
vars:
  title: Test
transforms:
`;
			const result = parse(yaml);
			assert.ok(result.vars);
			assert.ok(result.transforms === null || result.transforms === undefined);
		});
	});

	suite('Edge Cases', () => {
		test('handles completely empty config', () => {
			const yaml = '';
			const result = parse(yaml);
			assert.ok(result === null || typeof result === 'object');
		});

		test('handles config with only comments', () => {
			const yaml = `
# This is a comment
# Another comment
`;
			const result = parse(yaml);
			assert.ok(result === null || typeof result === 'object');
		});

		test('handles vars with special characters in keys', () => {
			const yaml = `
vars:
  "special-key": value
  "key.with.dots": another
`;
			const result = parse(yaml);
			assert.strictEqual(result.vars['special-key'], 'value');
			assert.strictEqual(result.vars['key.with.dots'], 'another');
		});

		test('handles multiline string values', () => {
			const yaml = `
vars:
  description: |
    This is a long
    multiline description
`;
			const result = parse(yaml);
			assert.ok(result.vars.description.includes('multiline'));
		});

		test('handles array values in vars', () => {
			const yaml = `
vars:
  items:
    - item1
    - item2
    - item3
`;
			const result = parse(yaml);
			assert.ok(Array.isArray(result.vars.items));
			assert.strictEqual(result.vars.items.length, 3);
		});

		test('handles numeric values', () => {
			const yaml = `
vars:
  port: 8080
  version: 1.5
  count: 0
`;
			const result = parse(yaml);
			assert.strictEqual(result.vars.port, 8080);
			assert.strictEqual(result.vars.version, 1.5);
			assert.strictEqual(result.vars.count, 0);
		});

		test('handles boolean values', () => {
			const yaml = `
vars:
  enabled: true
  disabled: false
`;
			const result = parse(yaml);
			assert.strictEqual(result.vars.enabled, true);
			assert.strictEqual(result.vars.disabled, false);
		});

		test('handles null values', () => {
			const yaml = `
vars:
  nullValue: null
  emptyValue:
`;
			const result = parse(yaml);
			assert.strictEqual(result.vars.nullValue, null);
		});
	});

	suite('Invalid Configurations', () => {
		test('throws on invalid YAML syntax', () => {
			const yaml = `
vars:
  title: "unclosed string
`;
			assert.throws(() => parse(yaml));
		});

		test('throws on malformed indentation', () => {
			const yaml = `
vars:
title: Wrong Indent
`;
			assert.throws(() => parse(yaml));
		});

		test('handles duplicate keys (last wins)', () => {
			const yaml = `
vars:
  key: first
  key: second
`;
			const result = parse(yaml);
			assert.strictEqual(result.vars.key, 'second');
		});
	});

	suite('Transform Specifications', () => {
		test('extracts source and target from object', () => {
			const yaml = `
transforms:
  - source: a.njk
    target: a.txt
`;
			const result = parse(yaml);
			const transform = result.transforms[0];
			assert.strictEqual(transform.source, 'a.njk');
			assert.strictEqual(transform.target, 'a.txt');
			assert.strictEqual(transform.recursive, undefined);
		});

		test('extracts recursive flag', () => {
			const yaml = `
transforms:
  - source: dir/
    target: out/
    recursive: false
`;
			const result = parse(yaml);
			const transform = result.transforms[0];
			assert.strictEqual(transform.recursive, false);
		});

		test('handles transforms with extra properties', () => {
			const yaml = `
transforms:
  - source: a.njk
    target: a.txt
    custom: ignored
`;
			const result = parse(yaml);
			const transform = result.transforms[0];
			assert.strictEqual(transform.source, 'a.njk');
			assert.strictEqual(transform.custom, 'ignored');
		});
	});
});
