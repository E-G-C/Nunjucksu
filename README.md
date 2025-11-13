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

Each `.njk.yaml` file must be valid YAML. All files found under `**/.vscode/*.njk.yaml` are merged (later files override earlier ones). **Note**: Variable merging uses shallow `Object.assign` - later files will completely replace nested objects rather than deep merging them.

### `vars`

Optional mapping of variables that will be provided to every template.

```yaml
vars:
  company: Example Co
  author:
    name: Ada
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

The extension auto-activates when it detects at least one `.vscode/*.njk.yaml` file in the workspace.

## Known Limitations

- Templates are rendered using UTF-8 encoding.
- Large batches of simultaneous changes to the same source are processed sequentially (queued with 30-second timeout).
- Config changes reload watchers but do not trigger automatic renders; run the command to refresh outputs immediately after edits.
- Variable merging uses shallow assignment—nested objects in later config files completely replace earlier ones rather than deep merging.

## Release Notes

See `CHANGELOG.md` for detailed release information.
