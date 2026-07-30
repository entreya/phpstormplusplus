import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';
import { resolveAt } from '../language/positionResolver';
import { UNUSED_IMPORT_CODE } from '../language/importDiagnostics';
import { buildAutoImportEdit, buildRemoveImportEdit } from './importManager';

export class ImportCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private index: PhpIndex) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const file = this.index.getFile(document.uri);
    if (!file) return [];
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== UNUSED_IMPORT_CODE) continue;
      const stmt = file.useStatements.find((u) => u.itemRange.isEqual(diagnostic.range));
      if (!stmt) continue;
      const action = new vscode.CodeAction(`Remove unused import '${stmt.alias}'`, vscode.CodeActionKind.QuickFix);
      action.edit = new vscode.WorkspaceEdit();
      action.edit.set(document.uri, [buildRemoveImportEdit(document, stmt)]);
      action.diagnostics = [diagnostic];
      actions.push(action);
    }

    const ref = resolveAt(file.ast, range.start);
    if (ref?.type === 'class' && !ref.name.includes('\\')) {
      for (const cls of this.index.findClassesByName(ref.name)) {
        const importEdit = buildAutoImportEdit(file, document, cls);
        if (!importEdit) continue;
        const action = new vscode.CodeAction(`Import \\${cls.fqcn}`, vscode.CodeActionKind.QuickFix);
        action.edit = new vscode.WorkspaceEdit();
        action.edit.set(document.uri, [importEdit]);
        actions.push(action);
      }
    }

    return actions;
  }
}
