# Nunjucksu VS Code Extension

Render Nunjucks templates automatically when their source files change. The Nunjucksu extension watches `.njk.yaml` configuration files inside `.vscode/` folders, loads shared variables from YAML, and renders only the targets whose source just changed. Transforms can point at individual files or entire directories and will mirror `.njk` templates into their destination folders. Any `*.njk` template is also rendered to a sibling file with the `.njk` suffix removed, so `about.md.njk` outputs `about.md` by default.

## Quick Start

1. Create `.vscode/templates.njk.yaml` in your workspace:

```yaml
vars:
  title: My Project
  today: 2025-11-10

transforms:
  - source: templates/readme.md.njk
    target: README.md
  - source: templates/pages
    target: docs/pages
    recursive: true
```

1. Edit any listed source file (for example `templates/readme.md.njk`). When you save the file, the extension renders the template with the shared variables and overwrites the target (`README.md`). Templates that are not listed still render automatically when they end with `.njk`; the generated file lives beside the template with the `.njk` suffix removed. Use a transform entry when you want to write the output somewhere else.

1. Run the `Nunjucksu: Render Nunjucksu Templates` command to regenerate every configured target on demand.

## Configuration Reference

Configuration files can be either `.njk.yaml` or `.njk.json` format. These files can be placed in:

1. **`.vscode/` directory** - Global project configuration
2. **Directory root** - Local configuration files (`.njk.yaml` or `.njk.json`) that apply to that directory and its subdirectories

All configuration files are merged with directory-based precedence: variables defined in local configs (closer to the template) override those in parent directories. The `.vscode/` configs are treated as root-level configuration.

**Note**: Variable merging uses shallow `Object.assign` - later files will completely replace nested objects rather than deep merging them.

### Local Configuration Files

You can place `.njk.yaml` or `.njk.json` files in any directory to define variables scoped to that directory and its subdirectories. This allows for:

- **Project-wide defaults** in root `.vscode/` configs
- **Directory-specific overrides** using `.njk.yaml` or `.njk.json` in subdirectories
- **Template-specific variables** by placing config files near templates

**Example structure:**

```plaintext
project/
  .vscode/
    main.njk.yaml          # Global variables
  src/
    .njk.yaml              # Overrides for src/ directory
    components/
      .njk.json            # Overrides for components/ (JSON format)
      button.njk           # Uses: global → src → components variables
```

### `vars`

Optional mapping of variables that will be provided to every template.

```yaml
vars:
  company: Example Co
  author:
    name: Ada
```

**Variable Precedence:**

When a template is rendered, variables are resolved with the following precedence (highest to lowest):

1. Local config files in the template's directory
2. Local config files in parent directories (from deepest to shallowest)
3. Global config files in `.vscode/`

**Example:**

```yaml
# .vscode/main.njk.yaml
vars:
  env: production
  apiUrl: https://api.example.com
  theme: light

# src/.njk.yaml
vars:
  env: development
  theme: dark

# Template in src/page.njk will receive:
# env: development (overridden by src/.njk.yaml)
# apiUrl: https://api.example.com (from global)
# theme: dark (overridden by src/.njk.yaml)
```

### Nunjucks Template Examples

Templates can use variables and Nunjucks syntax:

**Simple variable substitution:**

```nunjucks
# {{ title }}

Welcome to {{ company }}!
```

**Conditionals:**

```nunjucks
{% if author %}
Author: {{ author.name }}
{% endif %}
```

**Loops:**

```nunjucks
{% for item in items %}
- {{ item }}
{% endfor %}
```

**Include other templates:**

```nunjucks
{% include "header.njk" %}
{{ content }}
{% include "footer.njk" %}
```

**Template inheritance:**

```nunjucks
{% extends "base.njk" %}

{% block content %}
  This is the page content
{% endblock %}
```

### `transforms`

Defines how templates are rendered. Supported shapes:

- Mapping of `source: target` pairs.
- Array of objects containing `source` and `target` keys (plus optional settings).
- Single object containing `source`, `target`, and optional settings.

Both `source` and `target` paths can be absolute or relative. Relative paths are resolved against the workspace root of the config file (or the config file directory if no workspace is open).

When multiple transforms share the same source file, every associated target is rendered after that source changes. Transforms where source and target resolve to the same file are ignored to prevent infinite loops.

### Directory transforms

Provide a transform with a `recursive` flag to mirror directories of templates. When `recursive` is `true`, every `.njk` template in the source directory and its subdirectories is rendered into the target directory, preserving the relative folder structure and dropping the `.njk` suffix. When `recursive` is `false`, only templates in the top-level directory are considered.

```yaml
transforms:
  - source: templates/emails
    target: build/emails
    recursive: false
```

## Behavior

- Discovers every template matching the configured extension (default: `.njk`) in the workspace and renders it to a sibling file without the extension.
- Directory transforms mirror templates from the configured source folder into the target folder, applying the configured recursion rules.
- Watches source files only; targets are overwritten by the renderer but do not trigger further renders.
- Uses **incremental updates** for template discovery—individual template changes don't trigger full workspace rescans, improving performance in large projects.
- **Cycle detection** prevents infinite loops when transforms reference each other (e.g., A → B and B → A).
- Each render uses a fresh Nunjucks environment with `autoescape` disabled (suitable for Markdown and plain text outputs).
- Render errors are reported in the `Nunjucksu` output channel and via VS Code warnings.
- **Additional search paths** can be configured to help Nunjucks resolve `{% include %}` and `{% extends %}` statements.

## Settings

| Setting                                  | Type     | Default    | Description                                                           |
| ---------------------------------------- | -------- | ---------- | --------------------------------------------------------------------- |
| `nunjucksu.logLevel`                     | string   | `"normal"` | Output verbosity: `"silent"`, `"normal"`, or `"verbose"`              |
| `nunjucksu.templateExtension`            | string   | `".njk"`   | File extension for templates (e.g., `".njk"`, `".nunjucks"`)          |
| `nunjucksu.additionalSearchPaths`        | string[] | `[]`       | Extra directories to search for `{% include %}` and `{% extends %}`   |

**Example settings.json:**

```json
{
  "nunjucksu.logLevel": "verbose",
  "nunjucksu.templateExtension": ".nunjucks",
  "nunjucksu.additionalSearchPaths": [
    "shared/templates",
    "common/includes"
  ]
}
```

## Commands

| Command ID                | Title                             | Description                                    |
| ------------------------- | --------------------------------- | ---------------------------------------------- |
| `nunjucksu.renderAll`     | Render Nunjucksu Templates        | Manually rerender every configured transform. |

The extension auto-activates when it detects at least one `.njk.yaml` or `.njk.json` configuration file in the workspace (either in `.vscode/` or in any directory).

## Known Limitations

- Templates are rendered using UTF-8 encoding.
- Large batches of simultaneous changes to the same source are processed sequentially (queued with 30-second timeout).
- Config changes reload watchers but do not trigger automatic renders; run the command to refresh outputs immediately after edits.
- Variable merging uses shallow assignment—nested objects in later config files completely replace earlier ones rather than deep merging.

## Release Notes

See `CHANGELOG.md` for detailed release information.
