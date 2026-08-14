import * as vscode from 'vscode';
import { FileEntry, FromExtensionMessage, FromWebviewMessage, SearchFileResult } from './webviews/fileExplorer/protocol';
import { buildSearchRegex, looksLikeTextFile, searchTextInFiles } from './core/textSearch';

const PROJECT_EXCLUDE_GLOB = '**/{node_modules,.git,dist,out,out-test,.vscode-test,vendor}/**';
const VENDOR_EXCLUDE_GLOB = '**/vendor/**/{tests,Tests,test,Test,docs,doc,examples,example,bin}/**';
// Enumerating file *names* is cheap (no I/O) — this cap only needs to be low
// enough to bound a pathological repo, not tuned for typical project sizes,
// so it's set generously. Content *reading* is the actually expensive part,
// which searchTextInFiles (via SEARCH_MAX_CONTENT_MATCHES + its own internal
// batch cap) bounds separately regardless of how big this number is.
const SEARCH_MAX_FILES = 50000;
const SEARCH_MAX_CONTENT_MATCHES = 500;

/**
 * Matches both file/path names and file contents against one query, which can
 * be plain text or (with `useRegex`) a real regular expression — VS Code's
 * own Find in Files supports both, so this does too. Returns undefined for
 * an invalid regex (caller reports that back to the user) rather than
 * silently falling back to a literal match, which would find the wrong
 * things without any indication why.
 *
 * Project files are scanned before vendor/, and vendor/ only gets whatever
 * budget is left under SEARCH_MAX_FILES — a large vendor/ tree previously
 * shared one uncapped file list with the project's own files, so on a real
 * project it could fill the entire cap and silently starve the user's own
 * files out of ever being searched at all.
 */
export async function searchWorkspace(query: string, useRegex: boolean, caseSensitive: boolean): Promise<SearchFileResult[] | undefined> {
  if (!query.trim()) return [];
  const regex = buildSearchRegex(query, useRegex, caseSensitive);
  if (!regex) return undefined;

  const projectFiles = await vscode.workspace.findFiles('**/*', PROJECT_EXCLUDE_GLOB, SEARCH_MAX_FILES);
  const remaining = SEARCH_MAX_FILES - projectFiles.length;
  const vendorFiles = remaining > 0 ? await vscode.workspace.findFiles('vendor/**/*', VENDOR_EXCLUDE_GLOB, remaining) : [];
  const allFiles = [...projectFiles, ...vendorFiles];

  const byPath = new Map<string, SearchFileResult>();
  for (const uri of allFiles) {
    const rel = vscode.workspace.asRelativePath(uri, false);
    if (regex.test(rel)) {
      byPath.set(uri.toString(), { path: uri.toString(), name: rel, nameMatch: true, matches: [] });
    }
  }

  const textCandidates = allFiles.filter(looksLikeTextFile);
  const contentMatches = await searchTextInFiles(regex, textCandidates, SEARCH_MAX_CONTENT_MATCHES);
  for (const m of contentMatches) {
    const key = m.uri.toString();
    const existing = byPath.get(key);
    const rel = vscode.workspace.asRelativePath(m.uri, false);
    if (existing) {
      existing.matches.push({ line: m.line, text: m.lineText });
    } else {
      byPath.set(key, { path: key, name: rel, nameMatch: false, matches: [{ line: m.line, text: m.lineText }] });
    }
  }

  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name));
}

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
          const editor = await vscode.window.showTextDocument(uri, { preview: false });
          if (message.line !== undefined) {
            const position = new vscode.Position(message.line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
          }
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
        case 'search': {
          const results = await searchWorkspace(message.query, message.useRegex, message.caseSensitive);
          this.post(webview, { type: 'searchResults', query: message.query, results: results ?? [], invalidRegex: !results });
          break;
        }
        case 'clearSearch':
          break;
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
  * { box-sizing: border-box; }
  button, input { font-family: inherit; font-size: inherit; }

  /* Hand-rolled tree/list/menu — no UI component library. A prior attempt
     using antd's Tree had its icon/title layout silently break (antd never
     gives .ant-tree-node-content-wrapper display:flex itself), which isn't a
     risk worth re-taking for something this layout-critical. Plain elements
     with our own CSS mean we own every pixel of this. */
  .pp-row { display: flex; align-items: center; cursor: pointer; padding: 1px 4px; border-radius: 3px; white-space: nowrap; }
  .pp-row:hover { background: var(--vscode-list-hoverBackground); }
  .pp-row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .pp-chevron { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex: none; opacity: 0.8; }
  .pp-chevron.empty { visibility: hidden; }
  .pp-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex: none; margin-right: 4px; }
  .pp-name { overflow: hidden; text-overflow: ellipsis; flex: auto; min-width: 0; }
  .pp-match-count { opacity: 0.6; font-size: 11px; margin-left: 6px; flex: none; }
  .pp-line-match { display: flex; padding: 1px 4px 1px 36px; cursor: pointer; border-radius: 3px; white-space: nowrap; overflow: hidden; }
  .pp-line-match:hover { background: var(--vscode-list-hoverBackground); }
  .pp-line-no { opacity: 0.6; margin-right: 8px; flex: none; }
  .pp-line-text { overflow: hidden; text-overflow: ellipsis; font-family: var(--vscode-editor-font-family); }

  .pp-context-menu { position: fixed; z-index: 1000; background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); color: var(--vscode-menu-foreground, var(--vscode-editorWidget-foreground)); border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border)); border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); padding: 4px 0; min-width: 160px; }
  .pp-context-menu-item { padding: 4px 12px; cursor: pointer; }
  .pp-context-menu-item:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-menu-selectionForeground, inherit); }
  .pp-context-menu-item.danger { color: var(--vscode-errorForeground, #f48771); }
  .pp-context-menu-sep { height: 1px; background: var(--vscode-menu-separatorBackground, var(--vscode-widget-border)); margin: 4px 0; }

  .pp-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; }
  .pp-toolbar-title { font-size: 11px; font-weight: 600; text-transform: uppercase; opacity: 0.75; }
  .pp-icon-button { background: transparent; border: none; color: inherit; cursor: pointer; padding: 2px 4px; border-radius: 3px; display: inline-flex; align-items: center; }
  .pp-icon-button:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .pp-icon-button.active { background: var(--vscode-inputOption-activeBackground); color: var(--vscode-inputOption-activeForeground); }

  .pp-search-box { display: flex; align-items: center; margin: 4px 8px; border: 1px solid var(--vscode-input-border, transparent); background: var(--vscode-input-background); border-radius: 3px; }
  .pp-search-box input { flex: auto; min-width: 0; background: transparent; border: none; outline: none; color: var(--vscode-input-foreground); padding: 3px 4px; }
  .pp-search-box.invalid { border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); }

  .pp-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  .pp-modal { background: var(--vscode-editorWidget-background); color: var(--vscode-editorWidget-foreground); border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 16px; width: 300px; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
  .pp-modal-title { font-weight: 600; margin-bottom: 10px; }
  .pp-modal input { width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: 5px 6px; outline: none; }
  .pp-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  .pp-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 3px; padding: 4px 12px; cursor: pointer; }
  .pp-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .pp-btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .pp-btn.primary:hover { background: var(--vscode-button-hoverBackground); }
  .pp-btn.danger { background: var(--vscode-errorForeground, #c53030); color: white; }

  .pp-error { color: var(--vscode-errorForeground); font-size: 12px; padding: 4px 8px; }
  .pp-empty { opacity: 0.7; padding: 8px; font-size: 12px; }
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
