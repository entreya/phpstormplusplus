# PHPStorm++

A VS Code extension bringing PhpStorm-style PHP tooling into VS Code: code
intelligence, refactorings, Live Templates, an Xdebug debugger, and
pluggable framework support (Yii2 first).

**This is not a claim of 1:1 PhpStorm parity.** PhpStorm is a commercial IDE
with a 15+ year, multi-million-line codebase. This extension implements a
real, working subset built from scratch (own PHP indexer, own DBGp/Xdebug
debug adapter, own DB drivers, own snippet engine) — see "Known limitations"
below for what's intentionally out of scope for now.

## What's implemented

| Area | What works today |
|---|---|
| **Code intelligence** | Workspace-wide PHP indexer (`src/core`) built on `php-parser`; hover, go-to-definition, find references, rename, document/workspace symbols, and context-aware completion (`->`, `::`, `new`) with lightweight local type inference. |
| **Refactoring** | Extract Variable, Extract Method (heuristic parameter inference), Generate Constructor, Generate Getters/Setters, Generate PHPDoc, and cross-file Rename Symbol. |
| **Live Templates** | PhpStorm-style abbreviation snippets (`fore`, `iff`, `try`, `pubf`, `docb`, ...) plus a `phpstormpp.liveTemplates` setting for your own. |
| **Debugging** | A DAP server that speaks Xdebug's DBGp protocol directly over TCP (`src/debug`) — breakpoints, step in/over/out, call stack, scopes/variables, watch/eval. No dependency on any existing PHP debug extension. |
| **Framework support** | A pluggable `FrameworkModule` API (`src/frameworks`). Yii2 ships first: project detection via `composer.json`, and Controller ↔ View navigation following Yii2's `controllerId`/`actionId` conventions. Add another framework by implementing the interface in `src/frameworks/types.ts` — nothing else needs to change. |

All of the above is exercised by an automated test suite that runs in a real
VS Code Extension Development Host (not just `tsc`) — see "Testing" below.

## Known limitations (by design, for now)

- **No full data-flow type inference.** Variable types are inferred from
  `$this`, parameter type hints, and the nearest `$x = new Foo()` in scope —
  not arbitrary call chains. Find Usages on methods/properties is name-based
  across the workspace, which can over-match same-named members on unrelated
  classes.
- **Extract Method** uses a regex-based free-variable heuristic, not real
  data-flow analysis — check the generated signature.
- **No framework-specific completion beyond Yii2 navigation yet** (no Blade,
  Twig, Eloquent/ActiveRecord attribute completion, etc.) — the plugin system
  is ready for it, the modules aren't written yet.
- **No VCS integration, no HTTP client, no profiler UI, no code-coverage UI,
  no deployment/Docker tooling.** PhpStorm 2026 also ships deep AI-agent
  integration (JetBrains Junie, Claude Agent) — out of scope here.
- **Debugger** covers the mainline workflow (breakpoints, stepping, variables,
  eval) but not every DBGp feature (e.g. conditional-breakpoint hit counts,
  multi-request/session juggling polish).

## Project layout

```
src/core/        PHP parsing + workspace symbol index (php-parser wrapper, extractor, PhpIndex)
src/language/    hover, go-to-definition, find references, completion, document/workspace symbols
src/refactor/    rename, extract variable/method, generate constructor/getters-setters, PHPDoc
src/templates/   Live Templates engine + default template set
src/debug/       DBGp protocol client + DAP debug adapter for Xdebug
src/frameworks/  FrameworkModule plugin API + Yii2 module
test/            @vscode/test-electron suite (real Extension Development Host tests)
test-fixtures/   sample PHP project used by the test suite and by `Run Extension` (F5)
```

## Getting started

```bash
npm install
npm run compile
```

Press **F5** in VS Code (or run the "Run Extension" launch config) to open an
Extension Development Host with `test-fixtures/` loaded.

To debug a PHP script: install Xdebug 3 in your PHP install, point it at
`client_port=9003`, then use the "Listen for Xdebug (PHPStorm++)" launch
configuration and run your script.

## Testing

```bash
npm test
```

This downloads a real VS Code build once, launches the extension inside it
against `test-fixtures/`, and asserts on actual provider output (hover text,
completion items, go-to-definition targets, generated PHPDoc, Yii2
navigation) — the same kind of check you'd get from manually exercising the
IDE, automated.

## Adding a framework module

Implement `FrameworkModule` from `src/frameworks/types.ts` (a `detect()` and
an `activate()`) and add it to `KNOWN_MODULES` in
`src/frameworks/frameworkRegistry.ts`. Enable it via the
`phpstormpp.frameworks.enabled` setting.
