# Nunjucksu Examples

## Local Configuration Files

### Example 1: Basic Directory-Level Variables

**Project Structure:**
```plaintext
my-project/
  .vscode/
    config.njk.yaml          # Global configuration
  src/
    src-config.njk.yaml      # Source directory config
    header.njk               # Template using src variables
    components/
      component-config.njk.json  # Component directory config (JSON format)
      button.njk             # Template using component variables
```

**Global Config** (`.vscode/config.njk.yaml`):
```yaml
vars:
  projectName: My Project
  version: 1.0.0
  environment: production
  baseUrl: https://example.com
```

**Source Directory Config** (`src/src-config.njk.yaml`):
```yaml
vars:
  environment: development
  debugMode: true
  baseUrl: http://localhost:3000
```

**Component Directory Config** (`src/components/component-config.njk.json`):
```json
{
  "vars": {
    "componentVersion": "2.1.0",
    "styleTheme": "dark"
  }
}
```

**Template** (`src/components/button.njk`):
```nunjucks
<!-- Button Component -->
<!-- Project: {{ projectName }} v{{ version }} -->
<!-- Environment: {{ environment }} -->
<!-- Base URL: {{ baseUrl }} -->
<!-- Component Version: {{ componentVersion }} -->
<!-- Theme: {{ styleTheme }} -->

<button class="btn btn-{{ styleTheme }}">
  Click Me
</button>
```

**Rendered Output** (`src/components/button`):
```html
<!-- Button Component -->
<!-- Project: My Project v1.0.0 -->
<!-- Environment: development -->
<!-- Base URL: http://localhost:3000 -->
<!-- Component Version: 2.1.0 -->
<!-- Theme: dark -->

<button class="btn btn-dark">
  Click Me
</button>
```

**Variable Resolution:**
- `projectName` and `version` come from global config
- `environment` and `baseUrl` are overridden by `src/src-config.njk.yaml`
- `componentVersion` and `styleTheme` are added by `src/components/component-config.njk.json`

### Example 2: Multi-Environment Setup

**Project Structure:**
```plaintext
project/
  .vscode/
    main.njk.yaml            # Global defaults
  environments/
    dev/
      dev-config.njk.yaml    # Development overrides
      config.json.njk        # Template for dev config
    staging/
      staging-config.njk.yaml # Staging overrides
      config.json.njk        # Template for staging config
    production/
      production-config.njk.yaml # Production overrides
      config.json.njk        # Template for production config
```

**Global Config** (`.vscode/main.njk.yaml`):
```yaml
vars:
  appName: MyApp
  port: 3000
  logLevel: info
  enableDebug: false
  apiUrl: https://api.example.com
```

**Dev Config** (`environments/dev/dev-config.njk.yaml`):
```yaml
vars:
  port: 8080
  logLevel: debug
  enableDebug: true
  apiUrl: http://localhost:4000
```

**Staging Config** (`environments/staging/staging-config.njk.yaml`):
```yaml
vars:
  port: 5000
  logLevel: warn
  apiUrl: https://staging-api.example.com
```

**Production Config** (`environments/production/production-config.njk.yaml`):
```yaml
vars:
  logLevel: error
  apiUrl: https://api.example.com
```

**Template** (`environments/dev/config.json.njk`):
```nunjucks
{
  "app": "{{ appName }}",
  "server": {
    "port": {{ port }},
    "logLevel": "{{ logLevel }}"
  },
  "features": {
    "debug": {{ enableDebug | lower }}
  },
  "api": {
    "baseUrl": "{{ apiUrl }}"
  }
}
```

**Rendered Dev Output** (`environments/dev/config.json`):
```json
{
  "app": "MyApp",
  "server": {
    "port": 8080,
    "logLevel": "debug"
  },
  "features": {
    "debug": true
  },
  "api": {
    "baseUrl": "http://localhost:4000"
  }
}
```

### Example 3: JSON Configuration Format

Local configs can use `.njk.json` format instead of YAML as long as the filename ends with `.njk.json`:

**Component Config** (`component-config.njk.json`):
```json
{
  "vars": {
    "componentName": "UserCard",
    "author": {
      "name": "Jane Doe",
      "email": "jane@example.com"
    },
    "styles": {
      "primary": "#007bff",
      "secondary": "#6c757d"
    }
  },
  "transforms": [
    {
      "source": "template.njk",
      "target": "output/component.html"
    }
  ]
}
```

### Example 4: Variable Precedence

When multiple config files define the same variable, the closest (deepest) config wins:

```plaintext
project/
  .vscode/
    main.njk.yaml          → theme: "light"
  src/
    src-config.njk.yaml    → theme: "auto"
    pages/
      pages-config.njk.yaml → theme: "dark"
      dashboard.njk        → Uses theme: "dark"
    components/
      header.njk           → Uses theme: "auto"
  docs/
    guide.md.njk           → Uses theme: "light"
```

## Best Practices

1. **Use `.vscode/` for global settings**: Keep project-wide defaults in `.vscode/*.njk.yaml`
2. **Use directory configs for local overrides**: Place `.njk.yaml` or `.njk.json` in directories that need specific variable values
3. **Choose YAML for readability, JSON for tooling**: Use YAML for human-readable configs, JSON when integrating with other tools
4. **Document your variables**: Add comments in YAML files to explain what each variable does
5. **Keep configs close to templates**: Place local config files near the templates that use them
