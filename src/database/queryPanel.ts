import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { DbConnectionConfig } from './types';

export function openQueryPanel(connections: ConnectionManager, config: DbConnectionConfig): void {
  const panel = vscode.window.createWebviewPanel('phpstormpp.queryPanel', `Query: ${config.name}`, vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true
  });

  panel.webview.html = renderHtml(panel.webview);

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command !== 'run') return;
    try {
      const driver = await connections.getDriver(config);
      const result = await driver.query(message.sql);
      panel.webview.postMessage({ command: 'result', columns: result.columns, rows: result.rows, rowCount: result.rowCount });
    } catch (e: any) {
      panel.webview.postMessage({ command: 'error', message: e.message });
    }
  });
}

function renderHtml(webview: vscode.Webview): string {
  const nonce = String(Date.now());
  return /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px; }
  textarea { width: 100%; height: 120px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); font-family: var(--vscode-editor-font-family); }
  button { margin-top: 6px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; cursor: pointer; }
  table { border-collapse: collapse; margin-top: 12px; width: 100%; }
  th, td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; font-size: 12px; }
  th { background: var(--vscode-editorWidget-background); }
  #status { margin-top: 8px; font-size: 12px; opacity: 0.8; }
</style>
</head>
<body>
  <textarea id="sql" placeholder="SELECT * FROM ..."></textarea><br/>
  <button id="run">Run (Ctrl+Enter)</button>
  <div id="status"></div>
  <div id="results"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const sqlEl = document.getElementById('sql');
    const statusEl = document.getElementById('status');
    const resultsEl = document.getElementById('results');

    function run() {
      statusEl.textContent = 'Running...';
      vscode.postMessage({ command: 'run', sql: sqlEl.value });
    }
    document.getElementById('run').addEventListener('click', run);
    sqlEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run();
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'error') {
        statusEl.textContent = 'Error: ' + msg.message;
        resultsEl.innerHTML = '';
        return;
      }
      if (msg.command === 'result') {
        statusEl.textContent = msg.rowCount + ' row(s)';
        const table = document.createElement('table');
        const thead = document.createElement('tr');
        for (const col of msg.columns) {
          const th = document.createElement('th');
          th.textContent = col;
          thead.appendChild(th);
        }
        table.appendChild(thead);
        for (const row of msg.rows) {
          const tr = document.createElement('tr');
          for (const cell of row) {
            const td = document.createElement('td');
            td.textContent = cell === null || cell === undefined ? 'NULL' : String(cell);
            tr.appendChild(td);
          }
          table.appendChild(tr);
        }
        resultsEl.innerHTML = '';
        resultsEl.appendChild(table);
      }
    });
  </script>
</body>
</html>`;
}
