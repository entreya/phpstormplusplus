import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';
import { PreviewViewProvider } from './previewPanel';

export interface EverywhereItem extends vscode.QuickPickItem {
  target: 'file' | 'class' | 'method' | 'command' | 'text';
  uri?: vscode.Uri;
  range?: vscode.Range;
  commandId?: string;
}

const TEXT_SEARCH_EXTENSIONS = new Set([
  '.php', '.phtml', '.js', '.jsx', '.ts', '.tsx', '.json', '.twig', '.html', '.htm', '.css', '.scss', '.md', '.yml',
  '.yaml', '.env', '.txt', '.xml', '.sql', '.blade.php'
]);
const CONTENT_SEARCH_DEBOUNCE_MS = 250;
const CONTENT_SEARCH_MIN_QUERY_LENGTH = 3;
const CONTENT_SEARCH_MAX_FILES = 4000;
const CONTENT_SEARCH_MAX_MATCHES = 40;
const CONTENT_SEARCH_BATCH_SIZE = 25;

export function looksLikeTextFile(uri: vscode.Uri): boolean {
  const path = uri.path.toLowerCase();
  for (const ext of TEXT_SEARCH_EXTENSIONS) {
    if (path.endsWith(ext)) return true;
  }
  return false;
}

/** Scans file contents for a literal, case-insensitive substring match — the
 * one thing name/symbol matching can never find (a log message, a string
 * literal, a comment, ...). Reads in small concurrent batches so it doesn't
 * serialize thousands of individual file reads one at a time. */
export async function searchFileContents(query: string, files: vscode.Uri[]): Promise<EverywhereItem[]> {
  const q = query.toLowerCase();
  const items: EverywhereItem[] = [];
  const limit = Math.min(files.length, CONTENT_SEARCH_MAX_FILES);

  for (let start = 0; start < limit && items.length < CONTENT_SEARCH_MAX_MATCHES; start += CONTENT_SEARCH_BATCH_SIZE) {
    const batch = files.slice(start, start + CONTENT_SEARCH_BATCH_SIZE);
    const reads = await Promise.all(
      batch.map(async (uri) => {
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          return { uri, text: Buffer.from(bytes).toString('utf8') };
        } catch {
          return undefined;
        }
      })
    );
    for (const read of reads) {
      if (!read) continue;
      const lines = read.text.split('\n');
      for (let i = 0; i < lines.length && items.length < CONTENT_SEARCH_MAX_MATCHES; i++) {
        if (!lines[i].toLowerCase().includes(q)) continue;
        const rel = vscode.workspace.asRelativePath(read.uri, false);
        items.push({
          label: `$(search) ${lines[i].trim().slice(0, 120)}`,
          description: `${rel}:${i + 1}`,
          target: 'text',
          uri: read.uri,
          range: new vscode.Range(i, 0, i, 0)
        });
      }
    }
  }
  return items;
}

/**
 * PhpStorm's "Search Everywhere" (double-Shift) merges file/class/symbol/action
 * search into one popup with a live preview as you navigate. VS Code splits
 * that into three separate pickers (Quick Open, Go to Symbol, Command Palette)
 * with no merged view — this command combines them, previewing the active
 * item in a dedicated bottom panel (see previewPanel.ts) rather than as an
 * editor tab, so browsing results never opens tabs no matter how the user has
 * `workbench.editor.enablePreview` configured.
 */
export function registerSearchEverywhere(index: PhpIndex, preview: PreviewViewProvider): vscode.Disposable {
  return vscode.commands.registerCommand('phpstormpp.searchEverywhere', async () => {
    const qp = vscode.window.createQuickPick<EverywhereItem>();
    qp.placeholder = 'Search Everywhere: files, classes, methods, commands, or text in files...';
    qp.matchOnDescription = true;

    let allFiles: vscode.Uri[] = [];
    let textFiles: vscode.Uri[] = [];
    let allCommands: string[] = [];
    void vscode.workspace.findFiles('**/*', '**/{node_modules,vendor,.git,dist,out}/**', 3000).then((f) => {
      allFiles = f;
      textFiles = f.filter(looksLikeTextFile);
    });
    void vscode.commands.getCommands(true).then((c) => (allCommands = c));

    function computeItems(query: string): EverywhereItem[] {
      if (!query.trim()) return [];
      const q = query.toLowerCase();
      const items: EverywhereItem[] = [];

      for (const uri of allFiles) {
        const rel = vscode.workspace.asRelativePath(uri, false);
        if (rel.toLowerCase().includes(q)) {
          items.push({ label: `$(file) ${rel.split('/').pop()}`, description: rel, target: 'file', uri });
          if (items.length > 30) break;
        }
      }

      for (const cls of index.allClasses()) {
        if (cls.name.toLowerCase().includes(q)) {
          items.push({
            label: `$(symbol-class) ${cls.name}`,
            description: cls.fqcn,
            target: 'class',
            uri: vscode.Uri.parse(cls.uri),
            range: cls.nameRange
          });
        }
        for (const m of cls.methods) {
          if (m.name.toLowerCase().includes(q)) {
            items.push({
              label: `$(symbol-method) ${cls.name}::${m.name}()`,
              description: cls.fqcn,
              target: 'method',
              uri: vscode.Uri.parse(cls.uri),
              range: m.nameRange
            });
          }
        }
      }

      for (const cmd of allCommands) {
        if (cmd.toLowerCase().includes(q) && !cmd.startsWith('_') && !cmd.startsWith('vscode.')) {
          items.push({ label: `$(run) ${cmd}`, target: 'command', commandId: cmd });
        }
      }

      return items.slice(0, 80);
    }

    let contentSearchToken = 0;
    let contentSearchTimer: ReturnType<typeof setTimeout> | undefined;

    qp.onDidChangeValue((value) => {
      qp.items = computeItems(value);

      if (contentSearchTimer) clearTimeout(contentSearchTimer);
      const token = ++contentSearchToken;
      if (value.trim().length < CONTENT_SEARCH_MIN_QUERY_LENGTH) return;

      qp.busy = true;
      contentSearchTimer = setTimeout(async () => {
        const textMatches = await searchFileContents(value, textFiles);
        if (token !== contentSearchToken) return; // query changed while we were scanning
        qp.busy = false;
        qp.items = [...computeItems(value), ...textMatches];
      }, CONTENT_SEARCH_DEBOUNCE_MS);
    });

    qp.onDidChangeActive(([active]) => {
      if (!active?.uri) {
        preview.clear();
        return;
      }
      void preview.showFile(active.uri, active.range);
    });

    qp.onDidAccept(async () => {
      const [selected] = qp.selectedItems;
      qp.hide();
      if (!selected) return;
      if (selected.target === 'command' && selected.commandId) {
        await vscode.commands.executeCommand(selected.commandId);
        return;
      }
      if (selected.uri) {
        const editor = await vscode.window.showTextDocument(selected.uri, { preview: false });
        if (selected.range) {
          editor.selection = new vscode.Selection(selected.range.start, selected.range.start);
          editor.revealRange(selected.range, vscode.TextEditorRevealType.InCenter);
        }
      }
    });

    qp.onDidHide(() => {
      if (contentSearchTimer) clearTimeout(contentSearchTimer);
      preview.clear();
      qp.dispose();
    });
    void vscode.commands.executeCommand(`${PreviewViewProvider.viewId}.focus`).then(undefined, () => {});
    qp.show();
  });
}
