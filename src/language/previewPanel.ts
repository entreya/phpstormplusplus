import * as vscode from 'vscode';

const PHP_KEYWORDS = new Set([
  'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch', 'class', 'clone', 'const', 'continue',
  'declare', 'default', 'do', 'echo', 'else', 'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach', 'endif',
  'endswitch', 'endwhile', 'enum', 'extends', 'final', 'finally', 'fn', 'for', 'foreach', 'function', 'global',
  'goto', 'if', 'implements', 'include', 'include_once', 'instanceof', 'insteadof', 'interface', 'isset', 'list',
  'match', 'namespace', 'new', 'or', 'print', 'private', 'protected', 'public', 'readonly', 'require', 'require_once',
  'return', 'static', 'switch', 'this', 'throw', 'trait', 'try', 'unset', 'use', 'var', 'while', 'xor', 'yield',
  'true', 'false', 'null', 'void', 'int', 'string', 'bool', 'float', 'object', 'mixed', 'self', 'parent'
]);

export interface Token {
  text: string;
  cls?: string;
}

/**
 * Lightweight regex-based PHP tokenizer for the preview panel — not a full
 * grammar (that's what our php-parser-based indexer is for; running it on an
 * arbitrary excerpt of a file, out of context, isn't reliable), just enough
 * to color comments/strings/variables/keywords/numbers so the preview reads
 * like PHP instead of a plain text dump.
 */
export function tokenizePhp(text: string): Token[] {
  const pattern =
    /(\/\*[\s\S]*?\*\/)|(\/\/[^\n]*)|(#[^\n]*)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|(\$[A-Za-z_]\w*)|\b([A-Za-z_]\w*)\b|\b(\d+(?:\.\d+)?)\b/g;
  const tokens: Token[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text))) {
    if (m.index > lastIndex) tokens.push({ text: text.slice(lastIndex, m.index) });
    let cls: string | undefined;
    if (m[1] || m[2] || m[3]) cls = 'cm';
    else if (m[4]) cls = 'str';
    else if (m[5]) cls = 'var';
    else if (m[6]) cls = PHP_KEYWORDS.has(m[6].toLowerCase()) ? 'kw' : undefined;
    else if (m[7]) cls = 'num';
    tokens.push({ text: m[0], cls });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) tokens.push({ text: text.slice(lastIndex) });
  return tokens;
}

/** Renders tokens as one <div class="line"> per source line (splitting any
 * token that spans a newline, e.g. a multi-line block comment) so the
 * active-line highlight wraps cleanly without ever producing invalid nested
 * HTML. */
function renderHighlightedLines(tokens: Token[], targetLineIndex: number): string {
  const lines: string[] = [''];
  for (const tok of tokens) {
    const parts = tok.text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push('');
      const escaped = escapeHtml(parts[i]);
      if (!escaped) continue;
      lines[lines.length - 1] += tok.cls ? `<span class="${tok.cls}">${escaped}</span>` : escaped;
    }
  }
  return lines.map((line, i) => `<div class="line${i === targetLineIndex ? ' hl' : ''}">${line || '&nbsp;'}</div>`).join('');
}

/**
 * A dedicated bottom-panel preview (registered as a WebviewView, not a text
 * editor) for Search Everywhere. Editor tabs — even ones opened with
 * `{ preview: true }` — get silently forced into permanent tabs whenever the
 * user has `workbench.editor.enablePreview: false`, since VS Code ignores the
 * per-call flag in that case. A webview view sidesteps that entirely: it's
 * not part of the editor tab system at all, so browsing results here never
 * opens a tab. A real tab only opens once the user accepts a result.
 */
export class PreviewViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'phpstormpp.preview';

  private view?: vscode.WebviewView;

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: false };
    this.renderEmpty();
  }

  async showFile(uri: vscode.Uri, range?: vscode.Range): Promise<void> {
    if (!this.view) return;
    let text: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      text = Buffer.from(bytes).toString('utf8');
    } catch {
      this.render(vscode.workspace.asRelativePath(uri), '(binary or unreadable file — no preview)');
      return;
    }

    const lines = text.split('\n');
    const targetLine = range?.start.line ?? 0;
    const from = Math.max(0, targetLine - 8);
    const to = Math.min(lines.length, targetLine + 25);

    const excerpt = lines.slice(from, to).join('\n');
    const tokens = uri.path.endsWith('.php') ? tokenizePhp(excerpt) : [{ text: excerpt }];
    const body = renderHighlightedLines(tokens, targetLine - from);

    this.render(vscode.workspace.asRelativePath(uri), body);
  }

  clear(): void {
    this.renderEmpty();
  }

  private renderEmpty(): void {
    this.render('', '<div class="line">Arrow through Search Everywhere results to preview them here.</div>');
  }

  private render(title: string, bodyHtml: string): void {
    if (!this.view) return;
    this.view.webview.html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { margin: 0; padding: 8px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
  .title { font-family: var(--vscode-font-family); font-size: 11px; opacity: 0.7; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .line { white-space: pre; min-height: 1.4em; }
  .line.hl { background: rgba(255, 235, 59, 0.18); }
  .kw { color: #cc7832; }
  .str { color: #6a8759; }
  .cm { color: #808080; font-style: italic; }
  .var { color: #9876aa; }
  .num { color: #6897bb; }
</style>
</head>
<body>
  <div class="title">${escapeHtml(title)}</div>
  ${bodyHtml}
</body>
</html>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}
