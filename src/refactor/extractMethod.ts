import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';

/**
 * Extract Method: moves the selected statements into a new private method on the
 * enclosing class and replaces the selection with a call. Parameters are inferred
 * heuristically (variables read in the selection that aren't first assigned inside
 * it); this covers the common case but, unlike PhpStorm, doesn't do full data-flow
 * analysis, so review the generated signature for anything unusual.
 */
export async function extractMethod(editor: vscode.TextEditor, index: PhpIndex): Promise<void> {
  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showWarningMessage('PHPStorm++: select one or more statements to extract first.');
    return;
  }
  const document = editor.document;
  const file = index.getFile(document.uri);
  const enclosing = file?.classes.find((c) => c.range.contains(selection.start));
  const enclosingMethod = enclosing?.methods.find((m) => m.range.contains(selection.start));
  if (!enclosing || !enclosingMethod) {
    vscode.window.showWarningMessage('PHPStorm++: Extract Method only works inside a class method right now.');
    return;
  }

  const selectedText = document.getText(selection);
  const referenced = new Set<string>();
  for (const m of selectedText.matchAll(/\$(\w+)/g)) referenced.add(m[1]);
  const locallyAssigned = new Set<string>();
  for (const m of selectedText.matchAll(/\$(\w+)\s*=(?!=)/g)) locallyAssigned.add(m[1]);
  const params = [...referenced].filter((v) => v !== 'this' && !locallyAssigned.has(v));

  const methodName = await vscode.window.showInputBox({ prompt: 'New method name', value: 'extracted' });
  if (!methodName) return;

  const hasReturn = /\breturn\b/.test(selectedText);
  const paramList = params.map((p) => `$${p}`).join(', ');
  const callArgs = paramList;
  const indent = document.lineAt(selection.start.line).text.match(/^\s*/)?.[0] ?? '    ';
  const methodIndent = indent;
  const bodyIndent = indent + '    ';

  const bodyLines = selectedText
    .split('\n')
    .map((l) => l.replace(/^\s*/, bodyIndent))
    .join('\n');

  const newMethod =
    `\n${methodIndent}private function ${methodName}(${paramList})\n` +
    `${methodIndent}{\n` +
    `${bodyLines}\n` +
    `${methodIndent}}\n`;

  const insertAt = new vscode.Position(enclosingMethod.range.end.line + 1, 0);
  const call = hasReturn ? `${indent}return $this->${methodName}(${callArgs});` : `${indent}$this->${methodName}(${callArgs});`;

  await editor.edit((builder) => {
    builder.insert(insertAt, newMethod);
    builder.replace(selection, call.trimStart());
  });
}
