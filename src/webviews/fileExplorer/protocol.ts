/** Message protocol between the extension host and the file explorer webview.
 * `path` fields are always a URI string as returned by `vscode.Uri.toString()`
 * — the webview treats them as opaque IDs and never parses them itself. */

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface SearchLineMatch {
  line: number;
  text: string;
}

export interface SearchFileResult {
  path: string;
  name: string;
  /** true if the query matched the file/path name itself, independent of any content matches */
  nameMatch: boolean;
  matches: SearchLineMatch[];
}

export type FromWebviewMessage =
  | { type: 'ready' }
  | { type: 'listDir'; path: string }
  | { type: 'openFile'; path: string; line?: number }
  | { type: 'createFile'; dirPath: string; name: string }
  | { type: 'createFolder'; dirPath: string; name: string }
  | { type: 'rename'; path: string; newName: string }
  | { type: 'delete'; path: string }
  | { type: 'search'; query: string; useRegex: boolean; caseSensitive: boolean }
  | { type: 'clearSearch' };

export type FromExtensionMessage =
  | { type: 'root'; path: string; name: string }
  | { type: 'dirListing'; path: string; entries: FileEntry[] }
  | { type: 'error'; message: string }
  | { type: 'refresh'; path: string }
  | { type: 'searchResults'; query: string; results: SearchFileResult[]; invalidRegex?: boolean };
