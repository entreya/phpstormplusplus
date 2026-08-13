/** Message protocol between the extension host and the file explorer webview.
 * `path` fields are always a URI string as returned by `vscode.Uri.toString()`
 * — the webview treats them as opaque IDs and never parses them itself. */

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export type FromWebviewMessage =
  | { type: 'ready' }
  | { type: 'listDir'; path: string }
  | { type: 'openFile'; path: string }
  | { type: 'createFile'; dirPath: string; name: string }
  | { type: 'createFolder'; dirPath: string; name: string }
  | { type: 'rename'; path: string; newName: string }
  | { type: 'delete'; path: string };

export type FromExtensionMessage =
  | { type: 'root'; path: string; name: string }
  | { type: 'dirListing'; path: string; entries: FileEntry[] }
  | { type: 'error'; message: string }
  | { type: 'refresh'; path: string };
