import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';
import { resolveAt } from '../language/positionResolver';
import { findReferences } from '../language/referenceProvider';

export class PhpRenameProvider implements vscode.RenameProvider {
  constructor(private index: PhpIndex) {}

  prepareRename(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Range> {
    const file = this.index.getFile(document.uri);
    if (!file) throw new Error('File is not indexed yet.');
    const ref = resolveAt(file.ast, position);
    if (!ref) throw new Error('Nothing renameable at this position.');
    return ref.range;
  }

  provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string): vscode.ProviderResult<vscode.WorkspaceEdit> {
    const file = this.index.getFile(document.uri);
    if (!file) return;
    const ref = resolveAt(file.ast, position);
    if (!ref) return;

    const locations = findReferences(this.index, file, ref, true);
    const edit = new vscode.WorkspaceEdit();
    for (const loc of locations) {
      edit.replace(loc.uri, loc.range, newName);
    }
    return edit;
  }
}
