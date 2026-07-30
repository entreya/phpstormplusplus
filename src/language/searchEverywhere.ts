import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';

interface EverywhereItem extends vscode.QuickPickItem {
  target: 'file' | 'class' | 'method' | 'command';
  uri?: vscode.Uri;
  range?: vscode.Range;
  commandId?: string;
}

/**
 * PhpStorm's "Search Everywhere" (double-Shift) merges file/class/symbol/action
 * search into one popup with a live preview as you navigate. VS Code splits
 * that into three separate pickers (Quick Open, Go to Symbol, Command Palette)
 * with no merged view — this command combines them, previewing the active
 * item as a background editor tab the same way VS Code's own Quick Open does.
 */
export function registerSearchEverywhere(index: PhpIndex): vscode.Disposable {
  return vscode.commands.registerCommand('phpstormpp.searchEverywhere', async () => {
    const qp = vscode.window.createQuickPick<EverywhereItem>();
    qp.placeholder = 'Search Everywhere: files, classes, methods, commands...';
    qp.matchOnDescription = true;

    let allFiles: vscode.Uri[] = [];
    let allCommands: string[] = [];
    void vscode.workspace.findFiles('**/*', '**/{node_modules,vendor,.git,dist,out}/**', 3000).then((f) => (allFiles = f));
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

    qp.onDidChangeValue((value) => {
      qp.items = computeItems(value);
    });

    qp.onDidChangeActive(async ([active]) => {
      if (!active?.uri) return;
      try {
        const editor = await vscode.window.showTextDocument(active.uri, { preview: true, preserveFocus: true });
        if (active.range) {
          editor.selection = new vscode.Selection(active.range.start, active.range.start);
          editor.revealRange(active.range, vscode.TextEditorRevealType.InCenter);
        }
      } catch {
        // binary or unreadable file — skip preview, selection still works
      }
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

    qp.onDidHide(() => qp.dispose());
    qp.show();
  });
}
