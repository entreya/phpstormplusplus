import * as vscode from 'vscode';
import { buildSearchSpec, runSmartGrep, searchRoots, SmartMatch, MatchCategory } from './smartGrep';
import { tokenizePhp } from './previewPanel';

/**
 * The Smart Grep UI: a single webview panel (editor area, not a sidebar) with a
 * search box, a grouped results list on the left, and a live file preview on
 * the right that highlights the matched line. A loader shows while a search
 * runs. Everything is driven by messages between the webview and this host:
 *   webview -> host : search / preview / open
 *   host -> webview : results / previewContent / loading / error
 */
export class SmartGrepPanel {
  public static current: SmartGrepPanel | undefined;
  private static readonly viewType = 'phpstormpp.smartGrep';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private searchSeq = 0;
  private cancelSource?: vscode.CancellationTokenSource;

  static show(extensionUri: vscode.Uri, extraRoots: string[], initialQuery = ''): void {
    const column = vscode.ViewColumn.Active;
    if (SmartGrepPanel.current) {
      SmartGrepPanel.current.panel.reveal(column);
      if (initialQuery) SmartGrepPanel.current.post({ type: 'setQuery', query: initialQuery });
      return;
    }
    const panel = vscode.window.createWebviewPanel(SmartGrepPanel.viewType, 'Smart Grep', column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [extensionUri]
    });
    SmartGrepPanel.current = new SmartGrepPanel(panel, extraRoots, initialQuery);
  }

  private constructor(panel: vscode.WebviewPanel, private readonly extraRoots: string[], initialQuery: string) {
    this.panel = panel;
    this.panel.webview.html = this.html(this.panel.webview);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => void this.onMessage(msg), null, this.disposables);
    if (initialQuery) this.post({ type: 'setQuery', query: initialQuery });
  }

  private async onMessage(msg: any): Promise<void> {
    switch (msg?.type) {
      case 'search':
        await this.doSearch(String(msg.query ?? ''), { regex: !!msg.regex, caseSensitive: !!msg.caseSensitive });
        break;
      case 'preview':
        await this.doPreview(String(msg.file), Number(msg.line));
        break;
      case 'open':
        await this.doOpen(String(msg.file), Number(msg.line), Number(msg.col) || 0);
        break;
    }
  }

  private async doSearch(query: string, opts: { regex: boolean; caseSensitive: boolean }): Promise<void> {
    const seq = ++this.searchSeq;
    this.cancelSource?.cancel();
    this.cancelSource?.dispose();

    if (!query.trim()) {
      this.post({ type: 'results', seq, groups: [], engine: '', truncated: false, query });
      return;
    }

    this.cancelSource = new vscode.CancellationTokenSource();
    this.post({ type: 'loading', seq });

    const spec = buildSearchSpec(query, opts);
    const roots = searchRoots(this.extraRoots);
    let result;
    try {
      result = await runSmartGrep(spec, roots, this.cancelSource.token);
    } catch (e: any) {
      if (seq === this.searchSeq) this.post({ type: 'error', seq, message: e?.message ?? String(e) });
      return;
    }
    if (seq !== this.searchSeq) return; // a newer search superseded this one

    this.post({
      type: 'results',
      seq,
      engine: result.engine,
      truncated: result.truncated,
      query,
      groups: this.toGroups(result.matches)
    });
  }

  private toGroups(matches: SmartMatch[]): { category: MatchCategory; items: SmartMatch[] }[] {
    const order: MatchCategory[] = ['definition', 'variable', 'usage'];
    const byCat = new Map<MatchCategory, SmartMatch[]>();
    for (const m of matches) {
      const list = byCat.get(m.category) ?? [];
      list.push(m);
      byCat.set(m.category, list);
    }
    return order.filter((c) => byCat.has(c)).map((category) => ({ category, items: byCat.get(category)! }));
  }

  private async doPreview(file: string, line: number): Promise<void> {
    const uri = vscode.Uri.file(file);
    let text: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      text = Buffer.from(bytes).toString('utf8');
    } catch {
      this.post({ type: 'previewContent', title: file, html: '<div class="pline">(unreadable file)</div>' });
      return;
    }
    const lines = text.split('\n');
    const target = Math.max(0, line - 1);
    const from = Math.max(0, target - 10);
    const to = Math.min(lines.length, target + 30);
    const excerpt = lines.slice(from, to).join('\n');
    const tokens = file.toLowerCase().endsWith('.php') || file.toLowerCase().endsWith('.phtml') ? tokenizePhp(excerpt) : [{ text: excerpt }];
    const html = this.renderPreview(tokens, target - from, from);
    this.post({ type: 'previewContent', title: vscode.workspace.asRelativePath(uri), html });
  }

  private renderPreview(tokens: { text: string; cls?: string }[], targetIndex: number, startLine: number): string {
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
    return lines
      .map((line, i) => {
        const ln = startLine + i + 1;
        const hl = i === targetIndex ? ' hl' : '';
        return `<div class="pline${hl}"><span class="pno">${ln}</span><span class="pcode">${line || '&nbsp;'}</span></div>`;
      })
      .join('');
  }

  private async doOpen(file: string, line: number, col: number): Promise<void> {
    const uri = vscode.Uri.file(file);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const pos = new vscode.Position(Math.max(0, line - 1), Math.max(0, col - 1));
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  dispose(): void {
    SmartGrepPanel.current = undefined;
    this.cancelSource?.cancel();
    this.cancelSource?.dispose();
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private html(webview: vscode.Webview): string {
    const nonce = String(Date.now()) + Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  html, body { height: 100%; margin: 0; }
  body { display: flex; flex-direction: column; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  .top { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3)); }
  .top input[type=text] { flex: auto; min-width: 0; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: 5px 8px; outline: none; }
  .toggle { cursor: pointer; user-select: none; border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.4)); border-radius: 3px; padding: 3px 7px; font-size: 11px; opacity: 0.8; }
  .toggle.on { background: var(--vscode-inputOption-activeBackground); color: var(--vscode-inputOption-activeForeground); border-color: var(--vscode-inputOption-activeBorder, transparent); opacity: 1; }
  .spinner { width: 14px; height: 14px; border: 2px solid rgba(128,128,128,0.4); border-top-color: var(--vscode-progressBar-background, #0e70c0); border-radius: 50%; animation: spin 0.7s linear infinite; display: none; flex: none; }
  .spinner.show { display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .status { font-size: 11px; opacity: 0.7; padding: 2px 10px; min-height: 16px; }
  .main { flex: auto; display: flex; min-height: 0; }
  .results { width: 42%; min-width: 220px; overflow: auto; border-right: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3)); }
  .preview { flex: auto; overflow: auto; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
  .ptitle { font-size: 11px; opacity: 0.7; padding: 6px 10px; position: sticky; top: 0; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .group-head { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.7; padding: 6px 10px 2px; position: sticky; top: 0; background: var(--vscode-editor-background); }
  .row { padding: 3px 10px 3px 20px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row.sel { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .row .loc { opacity: 0.65; font-size: 11px; }
  .row .snippet { font-family: var(--vscode-editor-font-family); }
  .pline { white-space: pre; display: flex; }
  .pline.hl { background: rgba(255, 213, 0, 0.16); }
  .pno { display: inline-block; width: 48px; text-align: right; padding-right: 12px; opacity: 0.5; flex: none; user-select: none; }
  .pcode { flex: auto; }
  .empty { opacity: 0.6; padding: 14px; font-size: 12px; }
  .kw { color: #cc7832; } .str { color: #6a8759; } .cm { color: #808080; font-style: italic; } .var { color: #9876aa; } .num { color: #6897bb; }
</style>
</head>
<body>
  <div class="top">
    <input id="q" type="text" placeholder="Search functions, classes, variables, text…  (⏎ to open)" autofocus>
    <span id="rx" class="toggle" title="Treat query as a regular expression">.*</span>
    <span id="cs" class="toggle" title="Case sensitive">Aa</span>
    <span id="spin" class="spinner"></span>
  </div>
  <div id="status" class="status"></div>
  <div class="main">
    <div id="results" class="results"><div class="empty">Type to search across your PHP source.</div></div>
    <div class="preview"><div id="ptitle" class="ptitle"></div><div id="pbody"></div></div>
  </div>
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    const q = document.getElementById('q');
    const spin = document.getElementById('spin');
    const statusEl = document.getElementById('status');
    const resultsEl = document.getElementById('results');
    const ptitle = document.getElementById('ptitle');
    const pbody = document.getElementById('pbody');
    const rx = document.getElementById('rx');
    const cs = document.getElementById('cs');
    let flat = [];       // flattened match list in display order
    let selected = -1;
    let debounce;

    function opts() { return { regex: rx.classList.contains('on'), caseSensitive: cs.classList.contains('on') }; }
    function fire() {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const o = opts();
        vscodeApi.postMessage({ type: 'search', query: q.value, regex: o.regex, caseSensitive: o.caseSensitive });
      }, 180);
    }
    q.addEventListener('input', fire);
    rx.addEventListener('click', () => { rx.classList.toggle('on'); fire(); });
    cs.addEventListener('click', () => { cs.classList.toggle('on'); fire(); });

    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter' && selected >= 0 && flat[selected]) {
        const m = flat[selected];
        vscodeApi.postMessage({ type: 'open', file: m.file, line: m.line, col: m.col });
      }
    });

    function move(delta) {
      if (!flat.length) return;
      selected = (selected + delta + flat.length) % flat.length;
      renderSelection();
      const m = flat[selected];
      vscodeApi.postMessage({ type: 'preview', file: m.file, line: m.line });
    }

    function renderSelection() {
      [...resultsEl.querySelectorAll('.row')].forEach((el, i) => el.classList.toggle('sel', i === selected));
      const sel = resultsEl.querySelector('.row.sel');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }

    const CAT_LABEL = { definition: 'Definition', variable: 'Variable', usage: 'Usage' };

    function render(groups) {
      flat = [];
      if (!groups.length) { resultsEl.innerHTML = '<div class="empty">No matches.</div>'; return; }
      let html = '';
      for (const g of groups) {
        html += '<div class="group-head">' + CAT_LABEL[g.category] + ' (' + g.items.length + ')</div>';
        for (const m of g.items) {
          const idx = flat.length; flat.push(m);
          const rel = m.file.split(/[\\\\/]/).pop();
          html += '<div class="row" data-i="' + idx + '"><div class="loc">' + escapeHtml(rel) + ':' + m.line + '</div>'
                + '<div class="snippet">' + escapeHtml(m.text.trim().slice(0, 200)) + '</div></div>';
        }
      }
      resultsEl.innerHTML = html;
      [...resultsEl.querySelectorAll('.row')].forEach((el) => {
        el.addEventListener('click', () => { selected = Number(el.dataset.i); renderSelection(); const m = flat[selected]; vscodeApi.postMessage({ type: 'preview', file: m.file, line: m.line }); });
        el.addEventListener('dblclick', () => { const m = flat[Number(el.dataset.i)]; vscodeApi.postMessage({ type: 'open', file: m.file, line: m.line, col: m.col }); });
      });
      // Auto-select & preview the first result.
      if (flat.length) { selected = 0; renderSelection(); const m = flat[0]; vscodeApi.postMessage({ type: 'preview', file: m.file, line: m.line }); }
    }

    function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

    window.addEventListener('message', (ev) => {
      const msg = ev.data;
      if (msg.type === 'loading') { spin.classList.add('show'); statusEl.textContent = 'Searching…'; }
      else if (msg.type === 'results') {
        spin.classList.remove('show');
        const total = msg.groups.reduce((n, g) => n + g.items.length, 0);
        statusEl.textContent = msg.query ? (total + ' match' + (total === 1 ? '' : 'es') + (msg.engine ? ' · ' + msg.engine : '') + (msg.truncated ? ' (showing first 500)' : '')) : '';
        pbody.innerHTML = ''; ptitle.textContent = '';
        render(msg.groups);
      }
      else if (msg.type === 'previewContent') { ptitle.textContent = msg.title; pbody.innerHTML = msg.html; const hl = pbody.querySelector('.pline.hl'); if (hl) hl.scrollIntoView({ block: 'center' }); }
      else if (msg.type === 'error') { spin.classList.remove('show'); statusEl.textContent = 'Error: ' + msg.message; }
      else if (msg.type === 'setQuery') { q.value = msg.query; q.focus(); fire(); }
    });

    q.focus();
  </script>
</body>
</html>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}
