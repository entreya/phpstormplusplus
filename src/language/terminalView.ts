import * as vscode from 'vscode';

/**
 * Backs the PHPStorm++ activity-bar icon. Clicking that icon reveals this view,
 * and the whole point is that it drops you straight into a terminal rather than
 * a file tree: on reveal (and again every time it becomes visible) it runs
 * `phpstormpp.openTerminal`, which focuses the shared "PHPStorm++" terminal or
 * creates it. The sidebar body itself is just a thin placeholder with a button
 * to reopen the terminal if it was closed — VS Code has no API to bind an
 * activity-bar icon directly to a command, so a minimal view is the closest we
 * can get to "icon = open terminal".
 */
export class TerminalLauncherViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'phpstormpp.main';

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: { type?: string }) => {
      if (message?.type === 'openTerminal') void vscode.commands.executeCommand('phpstormpp.openTerminal');
    });

    void vscode.commands.executeCommand('phpstormpp.openTerminal');
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) void vscode.commands.executeCommand('phpstormpp.openTerminal');
    });
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = String(Date.now()) + Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  html, body { height: 100%; margin: 0; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 16px; text-align: center; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); box-sizing: border-box; }
  p { margin: 0; opacity: 0.8; line-height: 1.4; }
  button { cursor: pointer; border: none; border-radius: 3px; padding: 6px 14px; font-family: inherit; font-size: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
  <p>The PHPStorm++ terminal opens below.</p>
  <button id="open" type="button">Open Terminal</button>
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    document.getElementById('open').addEventListener('click', () => vscodeApi.postMessage({ type: 'openTerminal' }));
  </script>
</body>
</html>`;
  }
}
