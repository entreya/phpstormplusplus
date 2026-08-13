import * as vscode from 'vscode';
import { FileEntry, FromExtensionMessage, FromWebviewMessage } from './webviews/fileExplorer/protocol';

/**
 * Extension-host side of the custom file/folder explorer webview. This is an
 * *additional* panel, not a replacement for VS Code's native Explorer — an
 * extension has no API to replace or re-render VS Code's own UI, only to add
 * webview content alongside it. Scoped to core operations (browse, open,
 * create, rename, delete) rather than full Explorer parity — no drag-drop,
 * no git decorations, no multi-select.
 */
export class FileExplorerViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'phpstormpp.main';

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const webview = webviewView.webview;
    webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webview.html = this.renderHtml(webview);

    webview.onDidReceiveMessage((message: FromWebviewMessage) => this.handleMessage(webview, message));
  }

  private async handleMessage(webview: vscode.Webview, message: FromWebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready': {
          const root = vscode.workspace.workspaceFolders?.[0];
          if (!root) {
            this.post(webview, { type: 'error', message: 'Open a folder to browse its files.' });
            return;
          }
          this.post(webview, { type: 'root', path: root.uri.toString(), name: root.name });
          break;
        }
        case 'listDir': {
          const uri = vscode.Uri.parse(message.path);
          const entries = await listDirectory(uri);
          this.post(webview, { type: 'dirListing', path: message.path, entries });
          break;
        }
        case 'openFile': {
          const uri = vscode.Uri.parse(message.path);
          await vscode.window.showTextDocument(uri, { preview: false });
          break;
        }
        case 'createFile': {
          const dirUri = vscode.Uri.parse(message.dirPath);
          const fileUri = vscode.Uri.joinPath(dirUri, message.name);
          if (await exists(fileUri)) throw new Error(`${message.name} already exists.`);
          await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
          this.post(webview, { type: 'refresh', path: message.dirPath });
          break;
        }
        case 'createFolder': {
          const dirUri = vscode.Uri.parse(message.dirPath);
          const folderUri = vscode.Uri.joinPath(dirUri, message.name);
          if (await exists(folderUri)) throw new Error(`${message.name} already exists.`);
          await vscode.workspace.fs.createDirectory(folderUri);
          this.post(webview, { type: 'refresh', path: message.dirPath });
          break;
        }
        case 'rename': {
          const uri = vscode.Uri.parse(message.path);
          const parent = vscode.Uri.joinPath(uri, '..');
          const target = vscode.Uri.joinPath(parent, message.newName);
          await vscode.workspace.fs.rename(uri, target, { overwrite: false });
          this.post(webview, { type: 'refresh', path: parent.toString() });
          break;
        }
        case 'delete': {
          const uri = vscode.Uri.parse(message.path);
          const parent = vscode.Uri.joinPath(uri, '..');
          // Trash rather than permanent delete — matches VS Code's own
          // Explorer default, so a mistaken delete stays recoverable.
          await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
          this.post(webview, { type: 'refresh', path: parent.toString() });
          break;
        }
      }
    } catch (e: any) {
      this.post(webview, { type: 'error', message: e?.message ?? String(e) });
    }
  }

  private post(webview: vscode.Webview, message: FromExtensionMessage): void {
    void webview.postMessage(message);
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview-fileExplorer.js'));
    const nonce = String(Date.now()) + Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: var(--vscode-sideBar-background); color: var(--vscode-sideBar-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  #root { height: 100%; }

  /* antd's Tree never gives .ant-tree-node-content-wrapper display:flex itself —
     it relies on the icon being inline-block and the title being plain inline
     content to sit side by side. Our own titleRender content doesn't meet that
     by default, and antd's own CSS-in-JS injection is not something we want a
     hard runtime dependency on inside a webview. These rules make the icon/
     title layout correct unconditionally, regardless of what antd's own
     styles do or don't apply here. */
  .ant-tree-treenode { display: flex !important; align-items: center !important; }
  .ant-tree-switcher { display: flex !important; align-items: center !important; justify-content: center !important; flex: none !important; }
  .ant-tree-checkbox { flex-shrink: 0 !important; }
  .ant-tree-node-content-wrapper { display: flex !important; align-items: center !important; flex: auto !important; min-width: 0 !important; }
  .ant-tree-iconEle { display: inline-flex !important; align-items: center !important; justify-content: center !important; flex: none !important; }
  .ant-tree-title { display: inline-block !important; flex: auto !important; min-width: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
</style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export async function listDirectory(uri: vscode.Uri): Promise<FileEntry[]> {
  const entries = await vscode.workspace.fs.readDirectory(uri);
  const mapped: FileEntry[] = entries.map(([name, fileType]) => ({
    name,
    path: vscode.Uri.joinPath(uri, name).toString(),
    isDirectory: (fileType & vscode.FileType.Directory) !== 0
  }));
  mapped.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return mapped;
}
