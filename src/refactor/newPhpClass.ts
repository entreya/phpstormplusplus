import * as vscode from 'vscode';
import { resolveNamespaceForPath } from '../core/namespaceResolver';

const KINDS = ['Class', 'Interface', 'Trait', 'Enum'] as const;

function boilerplate(keyword: string, className: string, namespace: string): { text: string; cursorLine: number } {
  const lines: string[] = ['<?php', ''];
  if (namespace) {
    lines.push(`namespace ${namespace};`, '');
  }
  lines.push(`${keyword} ${className}`, '{', '    ', '}', '');
  return { text: lines.join('\n'), cursorLine: lines.length - 3 };
}

/** PhpStorm's "New > PHP Class" dialog: pick a kind, type a name (optionally
 * namespace-qualified, e.g. "Sub\\Foo" creates a Sub/ subdirectory), and the
 * file is created with `<?php`, the PSR-4-resolved `namespace`, and the
 * declaration already filled in — cursor lands inside the body. */
export async function newPhpClass(folderUri?: vscode.Uri): Promise<void> {
  let targetDir = folderUri;
  if (!targetDir) {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    targetDir = activeUri ? vscode.Uri.joinPath(activeUri, '..') : vscode.workspace.workspaceFolders?.[0]?.uri;
  }
  if (!targetDir) {
    vscode.window.showWarningMessage('PHPStorm++: open a folder or file first.');
    return;
  }

  const kind = await vscode.window.showQuickPick([...KINDS], { title: 'New PHP Class' });
  if (!kind) return;

  const input = await vscode.window.showInputBox({
    title: `New PHP ${kind}`,
    placeHolder: 'Name, e.g. UserRepository or Sub\\UserRepository',
    validateInput: (v) => (/^[A-Za-z_][A-Za-z0-9_\\]*$/.test(v) ? undefined : 'Enter a valid PHP class/namespace name')
  });
  if (!input) return;

  const segments = input.split('\\').filter(Boolean);
  const className = segments.pop()!;
  const fileDir = segments.length ? vscode.Uri.joinPath(targetDir, ...segments) : targetDir;
  const fileUri = vscode.Uri.joinPath(fileDir, `${className}.php`);

  try {
    await vscode.workspace.fs.stat(fileUri);
    vscode.window.showErrorMessage(`PHPStorm++: ${className}.php already exists.`);
    return;
  } catch {
    // doesn't exist yet — good, proceed
  }

  const namespace = await resolveNamespaceForPath(fileDir);
  const { text, cursorLine } = boilerplate(kind.toLowerCase(), className, namespace);

  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(text, 'utf8'));
  const doc = await vscode.workspace.openTextDocument(fileUri);
  const editor = await vscode.window.showTextDocument(doc);
  const position = new vscode.Position(cursorLine, 4);
  editor.selection = new vscode.Selection(position, position);
}

const CLASS_LIKE_FILENAME = /^[A-Z][A-Za-z0-9_]*$/;

/**
 * Passive safety net for files created via VS Code's own "New File" flow
 * (Explorer New File, drag-and-drop) rather than our dedicated command: if a
 * brand-new, still-empty .php file has a PascalCase name (the PHP convention
 * for "this is a class file"), fill in the same `<?php` + namespace +
 * declaration boilerplate automatically. Files like `index.php` or
 * `bootstrap.php` are left alone since they're conventionally scripts, not
 * classes, and guessing wrong there would be more annoying than helpful.
 */
export function registerAutoClassOnCreate(): vscode.Disposable {
  return vscode.workspace.onDidCreateFiles(async (event) => {
    for (const uri of event.files) {
      if (!uri.path.endsWith('.php')) continue;
      const base = uri.path.split('/').pop()!.replace(/\.php$/, '');
      if (!CLASS_LIKE_FILENAME.test(base)) continue;

      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.length > 0) continue; // only fill genuinely empty files
      } catch {
        continue;
      }

      const dir = vscode.Uri.joinPath(uri, '..');
      const namespace = await resolveNamespaceForPath(dir);
      const { text } = boilerplate('class', base, namespace);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
    }
  });
}
