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
| **Code intelligence** | Workspace-wide PHP indexer (`src/core`) built on `php-parser`; hover, go-to-definition, find references, rename, document/workspace symbols, and context-aware completion (`->`, `::`, `new`) with lightweight local type inference. Files created or changed outside the editor are indexed live, including source behind directory symlinks that point outside the workspace (e.g. Composer path repositories linking `vendor/*` to sibling submodules) — a case VS Code's own watcher doesn't cover. Toggle with `phpstormpp.index.followSymlinkedRoots`. |
| **Refactoring** | Extract Variable, Extract Method (heuristic parameter inference), Generate Constructor, Generate Getters/Setters, Generate PHPDoc, and cross-file Rename Symbol. |
| **Formatting** | Own PHP formatter (`src/language/formatter.ts`) wired as the default `Format Document` provider for PHP. A deliberately safe reindenter: depth from real bracket tokens only, heredoc/nowdoc bodies + closers, multi-line strings, comments and inline HTML left byte-for-byte intact, trailing whitespace trimmed, blank-line runs collapsed (`phpstormpp.format.maxConsecutiveBlankLines`). It only ever rewrites whitespace, and bails without editing if anything else would change — so it can't corrupt code. |
| **Live Templates** | PhpStorm-style abbreviation snippets (`fore`, `iff`, `try`, `pubf`, `docb`, ...) plus a `phpstormpp.liveTemplates` setting for your own. |
| **Terminal** | The PHPStorm++ activity-bar icon opens a terminal directly (the shared "PHPStorm++" terminal), PhpStorm's Terminal-tool-window style. Also `phpstormpp.openTerminal`. |
| **Smart Grep** | An intelligent search panel (`Cmd+Shift+H` / `Ctrl+Shift+H`): type anything and it builds the right pattern. By default a name is a **substring ("like") match**, so `PromoteSt` finds `PromoteStudent`, `PromoteStudentController`, `$promoteStudent` and every call site; a `\b` toggle switches to exact whole-word, regex metacharacters switch to regex mode, and a phrase matches literally. Results are grouped into **Definition / Variable / Usage** and ranked (exact whole-word hits first), with a live syntax-highlighted preview of the selected match and a loader while the search runs. Engine is chosen with a fallback chain `ripgrep -> grep -> a built-in Node walker`, so it works even where neither binary is installed (e.g. a clean Windows box), and it searches symlinked source roots (submodules) too. |
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

## Setup for daily use (install + configure)

This section is for *using* PHPStorm++ in your editor (not developing it). Works
on macOS, Linux and Windows.

### 1. Install the extension

**From the packaged VSIX (recommended for now):**

- Command line (any OS — `code` must be on PATH; on Windows use PowerShell or CMD):
  ```bash
  code --install-extension phpstormplusplus-0.18.0.vsix
  ```
- Or from the UI: `Ctrl+Shift+X` (`Cmd+Shift+X` on macOS) → the `...` menu at the
  top of the Extensions panel → **Install from VSIX...** → pick the `.vsix`.

After installing, reload the window: Command Palette (`Ctrl+Shift+P` /
`Cmd+Shift+P`) → **Developer: Reload Window**. This is required after every
install/update, otherwise the old extension host keeps running.

> **Windows note:** if `code` isn't recognized on the command line, open VS Code
> → Command Palette → "Shell Command: Install 'code' command in PATH", or just
> use the "Install from VSIX..." UI method above.

### 2. Extensions you need / want alongside it

**Minimum (PHP tooling):**

| Extension | Required? | Why |
|---|---|---|
| **phantriviethoang.phpstorm-icon** | Auto-installed | PhpStorm-style file icons. Listed in this extension's `extensionPack`, so VS Code installs it for you. |
| **DEVSENSE PHP Tools** (`devsense.phptools-vscode`) *or* **Intelephense** (`bmewburn.vscode-intelephense-client`) | Optional | A full PHP language server for deep diagnostics (e.g. the `PHP0413 unknown class` squiggle comes from DEVSENSE, not from PHPStorm++). PHPStorm++ provides its own hover / go-to-definition / completion, so a second server is optional — but if you already run one, see "Avoiding overlap" below. |
| **PHP Debug** (`xdebug.php-debug`) | **Not needed** | PHPStorm++ ships its own Xdebug (DBGp) debug adapter (`phpstormpp-xdebug`). Don't run two Xdebug listeners on the same port. |

You do **not** need a separate formatter extension for PHP — PHPStorm++ registers
itself as the default `Format Document` provider for PHP.

#### Full "PhpStorm-like" interface (match my setup)

To reproduce the exact look and feel used while building this (theme, icons,
PHP tooling, and the little quality-of-life extensions), install the set below.
Grouped so you can skip anything you don't want.

**Look & feel (the "it looks like PhpStorm" part):**

| Extension | ID | Purpose |
|---|---|---|
| PhpStorm Theme | `ericgomez.phpstorm-theme` | PhpStorm/Darcula-style color theme. |
| JetBrains Icon Theme | `chadalen.vscode-jetbrains-icon-theme` | JetBrains-style file/folder icons. |
| PhpStorm Icon | `phantriviethoang.phpstorm-icon` | Alternative PhpStorm icon set (auto-installed by PHPStorm++). |
| Atom Material Theme | `tobiasalthoff.atom-material-theme` | Optional alternate theme. |
| Claude Themes | `zhangcy.claude-themes-by-zhangcy` | Optional alternate themes. |

> PHPStorm++ itself also ships two themes ("PHPStorm++ Dark (Darcula-inspired)"
> and "PHPStorm++ Light") and defaults to the dark one on first install. Pick
> whichever theme you prefer via **Preferences: Color Theme**.

**PHP language & quality:**

| Extension | ID | Purpose |
|---|---|---|
| DEVSENSE PHP Tools | `devsense.phptools-vscode` | Full PHP language server + diagnostics. |
| DEVSENSE Composer | `devsense.composer-php-vscode` | Composer integration. |
| DEVSENSE PHP Intelli | `devsense.intelli-php-vscode` | AI-assisted PHP completion. |
| DEVSENSE PHP Profiler | `devsense.profiler-php-vscode` | Profiling support. |
| PHP CS Fixer | `junstyle.php-cs-fixer` | Coding-standards fixer (separate from PHPStorm++'s formatter). |
| PHP String Syntax | `ericgomez.php-string-syntax` | Highlight embedded languages inside PHP strings. |

**Editor quality-of-life (the subtle PhpStorm-ish touches):**

| Extension | ID | Purpose |
|---|---|---|
| GitLens | `eamodio.gitlens` | Inline blame / history (PhpStorm-style VCS annotations). |
| Indent Rainbow | `oderwat.indent-rainbow` | Colored indentation guides. |
| Breakpoint Highlight | `ericgomez.breakpoint-highlight` | More visible breakpoint lines. |
| JS String Syntax | `ericgomez.js-string-syntax` | Embedded-language highlight in JS strings. |
| Rainbow CSV | `mechatroner.rainbow-csv` | Column-colored CSV viewing. |
| Prettier SQL | `inferrinizzard.prettier-sql-vscode` | SQL formatting. |
| GitHub-style Markdown Preview | `mccprogrammer.github-style-markdown-preview` | GitHub-flavored markdown preview. |
| GitHub Actions | `github.vscode-github-actions` | Workflow editing. |
| Rainbow Fart | `saekiraku.rainbow-fart` | Optional/fun — plays sounds while typing. Skip if not wanted. |

**Install them all in one go** (same command on macOS / Linux / Windows — run in
a terminal where `code` is on PATH):

```bash
# Look & feel
code --install-extension ericgomez.phpstorm-theme
code --install-extension chadalen.vscode-jetbrains-icon-theme
code --install-extension phantriviethoang.phpstorm-icon
code --install-extension tobiasalthoff.atom-material-theme
code --install-extension zhangcy.claude-themes-by-zhangcy

# PHP language & quality
code --install-extension devsense.phptools-vscode
code --install-extension devsense.composer-php-vscode
code --install-extension devsense.intelli-php-vscode
code --install-extension devsense.profiler-php-vscode
code --install-extension junstyle.php-cs-fixer
code --install-extension ericgomez.php-string-syntax

# Editor quality-of-life
code --install-extension eamodio.gitlens
code --install-extension oderwat.indent-rainbow
code --install-extension ericgomez.breakpoint-highlight
code --install-extension ericgomez.js-string-syntax
code --install-extension mechatroner.rainbow-csv
code --install-extension inferrinizzard.prettier-sql-vscode
code --install-extension mccprogrammer.github-style-markdown-preview
code --install-extension github.vscode-github-actions
```

> **To match the look exactly:** after installing, open **Preferences: Color
> Theme** and pick *PhpStorm Theme* (or *PHPStorm++ Dark*), and **Preferences:
> File Icon Theme** and pick *JetBrains* (or *PhpStorm*).

> **Not needed for PHP** (these were in my environment for other languages and
> are safe to skip): `dart-code.dart-code`, `dart-code.flutter`, `golang.go`,
> `ms-vscode.makefile-tools`, `openai.chatgpt`, `openai.codex-audio`.

### 3. Theme, font, icons & full settings (match my setup)

#### Font — JetBrains Mono

The editor font is **JetBrains Mono** with ligatures. It isn't bundled with VS
Code, so install the font on the OS first (otherwise VS Code silently falls back
to Menlo/Monaco/Consolas):

- **macOS:** `brew install --cask font-jetbrains-mono` (or download from
  <https://www.jetbrains.com/lp/mono/> and double-click to install).
- **Windows:** download from the same page, select all `.ttf` files, right-click
  → **Install for all users**. Or `winget install --id=JetBrains.Mono` if you
  have a package source that provides it.
- **Linux:** `sudo apt install fonts-jetbrains-mono` (Debian/Ubuntu) or unzip the
  download into `~/.local/share/fonts` and run `fc-cache -f`.

#### Theme & icons

- Color theme: **PhpStorm Dark** (from `ericgomez.phpstorm-theme`). PHPStorm++
  also ships *PHPStorm++ Dark (Darcula-inspired)* if you prefer its own.
- File icon theme: **phpstorm-icon** (from `phantriviethoang.phpstorm-icon`), or
  *JetBrains* (from `chadalen.vscode-jetbrains-icon-theme`).

Set them via **Preferences: Color Theme** and **Preferences: File Icon Theme**,
or they'll apply from the settings block below.

#### Settings — paste into your User `settings.json`

This is the exact configuration used while building this (same on macOS, Linux
and Windows). The quickest way to open the file is the Command Palette
(`Ctrl+Shift+P` / `Cmd+Shift+P`) → **Preferences: Open User Settings (JSON)**.
It lives at:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Code\User\settings.json` (= `C:\Users\<you>\AppData\Roaming\Code\User\settings.json`) |
| macOS | `~/Library/Application Support/Code/User/settings.json` |
| Linux | `~/.config/Code/User/settings.json` |

> `%APPDATA%` is hidden — paste `%APPDATA%\Code\User` into the File Explorer
> address bar to jump straight there. (VS Code **Insiders** uses `Code - Insiders`
> instead of `Code`.) Merge the block below into that file.

```jsonc
{
  // --- Appearance ---
  "workbench.colorTheme": "PhpStorm Dark",
  "workbench.iconTheme": "phpstorm-icon",
  "editor.fontFamily": "JetBrains Mono, Menlo, Monaco, monospace",
  "editor.fontLigatures": true,
  "editor.fontSize": 16,
  "editor.lineHeight": 26,
  "editor.fontWeight": "400",

  // --- Semantic colors (classes, namespaces, interfaces, properties) ---
  // Force semantic highlighting on and give class/namespace/etc. explicit
  // Darcula-like colors, so they're colored even if the theme doesn't define
  // semantic tokens itself. (See "Classes / namespaces have no color" below.)
  "editor.semanticHighlighting.enabled": true,
  "editor.semanticTokenColorCustomizations": {
    "enabled": true,
    "rules": {
      "class":     { "foreground": "#FFC66D" },
      "interface": { "foreground": "#B5B6E3" },
      "enum":      { "foreground": "#FFC66D" },
      "type":      { "foreground": "#FFC66D" },
      "namespace": { "foreground": "#A9B7C6" },
      "property":  { "foreground": "#9876AA" },
      "function":  { "foreground": "#FFC66D" },
      "method":    { "foreground": "#FFC66D" }
    }
  },

  "editor.cursorStyle": "line-thin",
  "editor.cursorBlinking": "smooth",
  "editor.cursorSmoothCaretAnimation": "on",
  "editor.smoothScrolling": true,
  "workbench.list.smoothScrolling": true,
  "editor.minimap.enabled": false,
  "breadcrumbs.enabled": true,
  "editor.stickyScroll.enabled": true,
  "editor.bracketPairColorization.enabled": true,
  "editor.guides.bracketPairs": true,
  "editor.guides.indentation": true,
  "editor.guides.highlightActiveIndentation": true,
  "terminal.integrated.fontSize": 15,
  "terminal.integrated.fontLigatures.enabled": true,
  "terminal.integrated.cursorBlinking": true,
  "explorer.compactFolders": false,
  "workbench.editor.enablePreview": false,
  "workbench.editor.highlightModifiedTabs": true,

  // --- IntelliSense / editing feel (PhpStorm-like) ---
  "editor.inlineSuggest.enabled": true,
  "editor.parameterHints.enabled": true,
  "editor.quickSuggestions": { "other": "on", "comments": "on", "strings": "on" },
  "editor.quickSuggestionsDelay": 0,
  "editor.acceptSuggestionOnEnter": "on",
  "editor.tabCompletion": "on",
  "editor.suggestSelection": "recentlyUsedByPrefix",
  "editor.snippetSuggestions": "inline",
  "editor.codeActions.triggerOnFocusChange": true,

  // --- Go to definition: jump straight through, never peek ---
  // Makes Ctrl/Cmd+click behave like one provider even with DEVSENSE/Intelephense also installed.
  "editor.definitionLinkOpensInPeek": false,
  "editor.gotoLocation.multipleDefinitions": "goto",
  "editor.gotoLocation.multipleDeclarations": "goto",
  "editor.gotoLocation.multipleImplementations": "goto",
  "editor.gotoLocation.multipleReferences": "goto",
  "editor.gotoLocation.multipleTypeDefinitions": "goto",

  // --- Formatting / save ---
  "editor.formatOnSave": true,
  "editor.formatOnPaste": true,
  "editor.formatOnType": true,
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1000,
  // My setup formats PHP with php-cs-fixer. To use PHPStorm++'s own formatter
  // instead, set this to "phpstormplusplus.phpstormplusplus".
  "[php]": {
    "editor.defaultFormatter": "junstyle.php-cs-fixer",
    "editor.semanticHighlighting.enabled": true
  },
  "php-cs-fixer.rules": "@PSR12,no_unused_imports,ordered_imports,array_indentation",
  "php-cs-fixer.onsave": true,
  // "php-cs-fixer.executablePath": "/opt/homebrew/bin/php-cs-fixer", // macOS; Windows: "C:\\\\path\\\\to\\\\php-cs-fixer.bat"

  // --- PHP language server (DEVSENSE and/or Intelephense) ---
  "php.suggest.basic": true,
  "intelephense.environment.phpVersion": "8.3",
  "intelephense.completion.insertUseDeclaration": true,
  "intelephense.files.exclude": ["**/.git/**", "**/node_modules/**", "**/vendor/bin/**", "**/views/**"],

  // --- Indent Rainbow (subtle, dark-friendly) ---
  "indentRainbow.colors": [
    "rgba(255,255,64,0.07)", "rgba(127,255,127,0.07)",
    "rgba(255,127,255,0.07)", "rgba(79,236,236,0.07)"
  ],
  "indentRainbow.errorColor": "rgba(128,32,32,0.6)",
  "indentRainbow.tabmixColor": "rgba(128,32,96,0.6)",

  // --- Search / git ---
  "search.smartCase": true,
  "search.followSymlinks": false,
  "git.autofetch": true,

  // --- PHPStorm++ specific ---
  // Index + watch PHP source behind directory symlinks pointing outside the
  // workspace (Composer path repos linking vendor/* to sibling submodules).
  "phpstormpp.index.followSymlinkedRoots": true,
  // Max consecutive blank lines PHPStorm++'s formatter keeps.
  "phpstormpp.format.maxConsecutiveBlankLines": 1
}
```

> **Windows paths:** anything pointing at a binary (like
> `php-cs-fixer.executablePath`) must use a Windows path with escaped
> backslashes, e.g. `"C:\\\\Users\\\\you\\\\php-cs-fixer.bat"`, or a forward-slash
> path `"C:/Users/you/php-cs-fixer.bat"`.

All PHPStorm++ settings: `phpstormpp.liveTemplates`,
`phpstormpp.frameworks.enabled`, `phpstormpp.format.maxConsecutiveBlankLines`,
`phpstormpp.index.followSymlinkedRoots`.

### 4. Multi-root workspace (submodules / Composer path repos)

If your real source lives in sibling submodules that are symlinked into
`vendor/` (so files are physically *outside* the main folder), add them as
real workspace folders in a `*.code-workspace` file. This is the most reliable
setup — VS Code's own watcher and search then see those files directly, and
go-to-definition works across them.

```jsonc
{
  "folders": [
    { "name": "app",        "path": "." },
    { "name": "evaluation", "path": "../submodules/uims_evaluation" },
    { "name": "core",       "path": "../submodules/uims_core" }
    // ...add the submodules you actually work in
  ],
  "settings": {
    "php.version": "7.4",
    "editor.gotoLocation.multipleDefinitions": "goto",
    // vendor/* are symlinks into ../submodules — exclude so hits don't double up.
    "search.exclude": { "**/vendor/uims": true, "**/runtime": true, "**/node_modules": true },
    "files.watcherExclude": { "**/vendor/**": true, "**/runtime/**": true, "**/node_modules/**": true }
  }
}
```

Open it via **File → Open Workspace from File...** (the `*.code-workspace`).
Even without this, PHPStorm++ will still discover and index symlinked roots on
its own (`phpstormpp.index.followSymlinkedRoots`), but adding them as folders
also fixes other extensions and native search.

### 5. Default keybindings

| Action | macOS | Windows / Linux |
|---|---|---|
| Smart Grep (intelligent search) | `Cmd+Shift+H` | `Ctrl+Shift+H` |
| Search Everywhere | `Cmd+;` | `Ctrl+;` |
| Command Center | `Cmd+Shift+;` | `Ctrl+Shift+;` |
| Reformat Code | `Cmd+Alt+L` | `Ctrl+Alt+L` |
| Go to Definition | `Cmd+B` / `Ctrl`+click | `Ctrl+B` / `Ctrl`+click |

### 6. Debugging (Xdebug) — all platforms

PHPStorm++ ships its own adapter (`phpstormpp-xdebug`), no PHP-debug extension
needed. Install Xdebug 3 in your PHP, then in `php.ini`:

```ini
zend_extension=xdebug          ; Windows: zend_extension=php_xdebug.dll
xdebug.mode=debug
xdebug.client_port=9003
xdebug.start_with_request=yes
```

Then use the **"Listen for Xdebug (PHPStorm++)"** launch config and run your
script. If PHP runs somewhere with different paths than your editor (a VM,
Docker, WSL, or Windows paths vs. a Linux container), add `pathMappings` so
breakpoints bind:

```jsonc
{
  "type": "phpstormpp-xdebug",
  "request": "launch",
  "name": "Listen for Xdebug (PHPStorm++)",
  "port": 9003,
  "pathMappings": {
    // "<path PHP sees>": "<path in your editor>"
    "/var/www/html": "${workspaceFolder}"
    // Windows example: "C:\\\\laragon\\\\www\\\\app": "${workspaceFolder}"
  }
}
```

### Troubleshooting: classes / namespaces have no color

If class names, namespaces, interfaces or enums show up plain (uncolored) while
keywords/strings are colored, the editor isn't applying **semantic**
highlighting to them. Two levels color PHP: TextMate (basic, regex) and
semantic (the language server tells the editor "this token is a class"). Fix:

1. **Add the semantic settings above** (`editor.semanticHighlighting.enabled`
   and `editor.semanticTokenColorCustomizations`). These force the colors on even
   when the color theme doesn't define semantic tokens — the usual cause, since
   many ported themes (including some PhpStorm-style ones) don't. This applies
   identically on Windows, macOS and Linux (they're colors/booleans, no paths).

2. **Make sure a PHP language server is actually running.** Semantic tokens come
   from DEVSENSE PHP Tools or Intelephense. Open a `.php` file and check the
   status bar. If both DEVSENSE and Intelephense are installed they can clash —
   disable one (`Ctrl+Shift+X` → the extension → Disable → **Developer: Reload
   Window**) and retest.

3. **Confirm what the token actually is.** Put the cursor on a class name →
   Command Palette → **Developer: Inspect Editor Tokens and Scopes**. In the
   popup, look at *semantic token type*:
   - shows `class` / `namespace` → semantic highlighting works, the color rules
     above will take effect;
   - blank/absent → the language server isn't providing it (revisit step 2), and
     the TextMate scope under *textmate scopes* is what's coloring (or not) the
     token instead.

### Windows-specific notes

- **Search engine fallback.** Smart Grep uses `ripgrep -> grep -> a built-in
  Node walker`. A clean Windows box usually has none of `rg`/`grep` on PATH —
  the Node walker is built in, so Smart Grep still works with no extra install.
  (Installing ripgrep, e.g. `winget install BurntSushi.ripgrep.MSVC`, just makes
  it faster.)
- **Line endings.** The formatter preserves the file's existing EOL (CRLF or
  LF). To standardize new files, set `"files.eol": "\r\n"` (or `"\n"`).
- **Symlinks.** The symlinked-root indexing uses the real on-disk target paths,
  so it works with Windows directory symlinks/junctions too. If a symlinked
  path isn't picked up, prefer the multi-root `*.code-workspace` approach above.
- **`code` on PATH:** installed automatically with VS Code on Windows; if
  missing, re-run the VS Code installer or use the "Install from VSIX..." UI.

### Avoiding overlap with another PHP language server

PHPStorm++ and DEVSENSE/Intelephense can both answer hover, go-to-definition and
completion. That's fine — the `editor.gotoLocation.multiple*: "goto"` settings
above make `Ctrl`+click jump straight through instead of showing a picker. If
you prefer a single provider for one feature, disable that capability in the
other extension's settings (e.g. Intelephense's `intelephense.*` toggles), and
keep PHPStorm++ for its unique features (Smart Grep, the formatter, Live
Templates, the terminal launcher, symlinked-submodule indexing).

## Project layout

```
src/core/        PHP parsing + workspace symbol index (php-parser wrapper, extractor, PhpIndex, symlinked-root discovery)
src/language/    hover, go-to-definition, find references, completion, document/workspace symbols, formatter, terminal launcher
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
