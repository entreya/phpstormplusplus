import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';

export async function generatePhpDoc(editor: vscode.TextEditor, index: PhpIndex): Promise<void> {
  const document = editor.document;
  const position = editor.selection.active;
  const file = index.getFile(document.uri);
  if (!file) return;

  let target: { params: { name: string; type?: string }[]; returnType?: string; range: vscode.Range; doc?: string } | undefined;

  for (const cls of file.classes) {
    for (const m of cls.methods) {
      if (m.range.contains(position)) {
        target = { params: m.params, returnType: m.returnType, range: m.range, doc: m.doc };
      }
    }
  }
  if (!target) {
    for (const fn of file.functions) {
      if (fn.range.contains(position)) {
        target = { params: fn.params, returnType: fn.returnType, range: fn.range, doc: fn.doc };
      }
    }
  }

  if (!target) {
    vscode.window.showWarningMessage('PHPStorm++: place the cursor inside a function or method first.');
    return;
  }
  if (target.doc) {
    vscode.window.showInformationMessage('PHPStorm++: a PHPDoc block already exists here.');
    return;
  }

  const indent = document.lineAt(target.range.start.line).text.match(/^\s*/)?.[0] ?? '';
  const lines = ['/**'];
  for (const p of target.params) {
    lines.push(` * @param ${p.type ?? 'mixed'} $${p.name}`);
  }
  if (target.returnType && target.returnType !== 'void') {
    lines.push(` * @return ${target.returnType}`);
  }
  lines.push(' */');
  const doc = lines.map((l) => indent + l).join('\n') + '\n';

  await editor.edit((builder) => builder.insert(new vscode.Position(target!.range.start.line, 0), doc));
}
