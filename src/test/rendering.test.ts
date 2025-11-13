import * as assert from 'assert';
import nunjucks from 'nunjucks';
import * as path from 'path';

suite('Nunjucks Template Rendering', () => {
	suite('Basic Variable Substitution', () => {
		test('renders simple variable', () => {
			const template = 'Hello {{ name }}!';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, { name: 'World' });
			assert.strictEqual(result, 'Hello World!');
		});

		test('renders multiple variables', () => {
			const template = '{{ greeting }} {{ name }}!';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, { greeting: 'Hi', name: 'Alice' });
			assert.strictEqual(result, 'Hi Alice!');
		});

		test('renders nested object properties', () => {
			const template = '{{ user.name }} - {{ user.email }}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, {
				user: { name: 'Bob', email: 'bob@example.com' }
			});
			assert.strictEqual(result, 'Bob - bob@example.com');
		});

		test('handles undefined variables gracefully', () => {
			const template = 'Value: {{ missing }}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, {});
			assert.strictEqual(result, 'Value: ');
		});
	});

	suite('Conditionals', () => {
		test('renders if block when condition is true', () => {
			const template = '{% if show %}Visible{% endif %}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, { show: true });
			assert.strictEqual(result, 'Visible');
		});

		test('skips if block when condition is false', () => {
			const template = '{% if show %}Visible{% endif %}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, { show: false });
			assert.strictEqual(result, '');
		});

		test('renders else block', () => {
			const template = '{% if show %}Yes{% else %}No{% endif %}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, { show: false });
			assert.strictEqual(result, 'No');
		});

		test('renders elif block', () => {
			const template = '{% if x == 1 %}One{% elif x == 2 %}Two{% else %}Other{% endif %}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, { x: 2 });
			assert.strictEqual(result, 'Two');
		});
	});

	suite('Loops', () => {
		test('renders for loop', () => {
			const template = '{% for item in items %}{{ item }},{% endfor %}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, { items: ['a', 'b', 'c'] });
			assert.strictEqual(result, 'a,b,c,');
		});

		test('handles empty array in loop', () => {
			const template = '{% for item in items %}{{ item }}{% endfor %}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, { items: [] });
			assert.strictEqual(result, '');
		});

		test('provides loop.index variable', () => {
			const template = '{% for item in items %}{{ loop.index }}:{{ item }} {% endfor %}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, { items: ['a', 'b'] });
			assert.strictEqual(result, '1:a 2:b ');
		});

		test('provides loop.first and loop.last', () => {
			const template = '{% for item in items %}{% if loop.first %}[{% endif %}{{ item }}{% if loop.last %}]{% else %},{% endif %}{% endfor %}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, { items: ['a', 'b', 'c'] });
			assert.strictEqual(result, '[a,b,c]');
		});
	});

	suite('Filters', () => {
		test('applies upper filter', () => {
			const template = '{{ name | upper }}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, { name: 'hello' });
			assert.strictEqual(result, 'HELLO');
		});

		test('applies lower filter', () => {
			const template = '{{ name | lower }}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, { name: 'WORLD' });
			assert.strictEqual(result, 'world');
		});

		test('applies default filter', () => {
			const template = '{{ missing | default("fallback") }}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, {});
			assert.strictEqual(result, 'fallback');
		});

		test('chains multiple filters', () => {
			const template = '{{ name | lower | upper }}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, { name: 'Test' });
			assert.strictEqual(result, 'TEST');
		});
	});

	suite('Whitespace Control', () => {
		test('preserves whitespace by default', () => {
			const template = '  {% if true %}  text  {% endif %}  ';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, {});
			assert.ok(result.includes('  text  '));
		});

		test('strips whitespace with minus operator', () => {
			const template = '  {%- if true -%}  text  {%- endif -%}  ';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, {});
			assert.strictEqual(result.trim(), 'text');
		});
	});

	suite('Comments', () => {
		test('removes comments from output', () => {
			const template = 'Before{# This is a comment #}After';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, {});
			assert.strictEqual(result, 'BeforeAfter');
		});

		test('handles multiline comments', () => {
			const template = `Before
{# 
  This is a
  multiline comment
#}
After`;
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, {});
			assert.ok(result.includes('Before'));
			assert.ok(result.includes('After'));
			assert.ok(!result.includes('multiline'));
		});
	});

	suite('Autoescape Setting', () => {
		test('autoescape disabled preserves HTML', () => {
			const template = '{{ html }}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, { html: '<b>Bold</b>' });
			assert.strictEqual(result, '<b>Bold</b>');
		});

		test('autoescape enabled escapes HTML', () => {
			const template = '{{ html }}';
			const environment = new nunjucks.Environment(null, { autoescape: true });
			const result = environment.renderString(template, { html: '<b>Bold</b>' });
			assert.ok(result.includes('&lt;'));
			assert.ok(result.includes('&gt;'));
		});

		test('safe filter bypasses autoescape', () => {
			const template = '{{ html | safe }}';
			const environment = new nunjucks.Environment(null, { autoescape: true });
			const result = environment.renderString(template, { html: '<b>Bold</b>' });
			assert.strictEqual(result, '<b>Bold</b>');
		});
	});

	suite('Error Handling', () => {
		test('throws on undefined filter', () => {
			const template = '{{ name | nonexistent }}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			assert.throws(() => {
				environment.renderString(template, { name: 'test' });
			});
		});

		test('throws on unclosed tag', () => {
			const template = '{% if true %}unclosed';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			assert.throws(() => {
				environment.renderString(template, {});
			});
		});

		test('throws on syntax error', () => {
			const template = '{% invalid syntax %}';
			const environment = new nunjucks.Environment(null, { autoescape: false });
			assert.throws(() => {
				environment.renderString(template, {});
			});
		});
	});

	suite('Complex Scenarios', () => {
		test('renders markdown document template', () => {
			const template = `# {{ title }}

## Introduction

{{ description }}

## Features

{% for feature in features %}
- {{ feature }}
{% endfor %}

## Contact

Email: {{ contact.email }}`;

			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, {
				title: 'My Project',
				description: 'A great project',
				features: ['Fast', 'Reliable', 'Easy'],
				contact: { email: 'info@example.com' }
			});

			assert.ok(result.includes('# My Project'));
			assert.ok(result.includes('- Fast'));
			assert.ok(result.includes('info@example.com'));
		});

		test('renders nested conditionals and loops', () => {
			const template = `{% for section in sections %}
## {{ section.title }}
{% if section.items %}
{% for item in section.items %}
- {{ item }}
{% endfor %}
{% else %}
No items
{% endif %}
{% endfor %}`;

			const environment = new nunjucks.Environment(null, { autoescape: false });
			const result = environment.renderString(template, {
				sections: [
					{ title: 'First', items: ['a', 'b'] },
					{ title: 'Second', items: [] }
				]
			});

			assert.ok(result.includes('## First'));
			assert.ok(result.includes('- a'));
			assert.ok(result.includes('No items'));
		});
	});
});
