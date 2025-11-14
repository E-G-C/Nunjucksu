# Change Log

All notable changes to the "nunjucksu" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added

- Initial TypeScript extension scaffold generated with Yeoman.
- Nunjucks renderer that watches `.vscode/*.njk.yaml` configs and re-renders only the targets whose source templates changed.
- Command `nunjucksu.renderAll` to manually regenerate every configured transform.
- Automatic discovery of workspace `*.njk` templates, rendering each one to a sibling file without the `.njk` suffix.
- Directory transforms that mirror `.njk` templates into target folders with optional recursion.
- **Local configuration files**: Support for `.njk.yaml` and `.njk.json` files in any directory
  - Variables defined in local configs override parent directory configs
  - Enables directory-scoped variable definitions
  - Supports both YAML and JSON formats for flexibility

### Changed

- Configuration files now use the `.njk.yaml` extension to enable YAML tooling in editors.
- Extension renamed from **Nunjucks** to **Nunjucksu**.
- Configuration discovery now searches for `.njk.yaml` and `.njk.json` files in all directories, not just `.vscode/`
