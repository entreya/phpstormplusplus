import * as vscode from 'vscode';

export async function extractVariable(editor: vscode.TextEditor): Promise<void> {
  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showWarningMessage('PHPStorm++: select an expression to extract first.');
    return;
  }
  const text = editor.document.getText(selection);
  const varName = await vscode.window.showInputBox({ prompt: 'New variable name', value: 'extracted' });
  if (!varName) return;

  const line = editor.document.lineAt(selection.start.line);
  const indent = line.text.match(/^\s*/)?.[0] ?? '';
  const insertPosition = new vscode.Position(selection.start.line, 0);

  await editor.edit((builder) => {
    builder.insert(insertPosition, `${indent}$${varName} = ${text};\n`);
    builder.replace(selection, `$${varName}`);
  });
}
