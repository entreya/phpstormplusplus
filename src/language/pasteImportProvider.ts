import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';
import { extractFileIndex } from '../core/symbolExtractor';
import { buildAutoImportEdit } from '../refactor/importManager';
import { walk } from '../core/astUtils';
import { parsePhp } from '../core/phpParser';

/**
 * PhpStorm's "add unambiguous imports on paste": pasting code that references
 * classes not yet imported in the target file automatically adds the `use`
 * statements for any reference that resolves to exactly one class in the
 * workspace. Ambiguous names (multiple classes sharing that simple name) are
 * deliberately skipped rather than guessed — same reasoning as the recent fix
 * to resolveClassName's fallback: a wrong auto-added import is worse than none.
 */
export class PasteImportProvider implements vscode.DocumentPasteEditProvider {
  constructor(private index: PhpIndex) {}

  async provideDocumentPasteEdits(
    document: vscode.TextDocument,
    _ranges: readonly vscode.Range[],
    dataTransfer: vscode.DataTransfer,
    _context: vscode.DocumentPasteEditContext,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentPasteEdit[] | undefined> {
    const textItem = dataTransfer.get('text/plain');
    if (!textItem) return undefined;
    const pastedText = await textItem.asString();
    if (token.isCancellationRequested || !pastedText.trim()) return undefined;

    const ast = parsePhp(`<?php\n${pastedText}`, 'paste.php');
    if (!ast) return undefined;

    const referencedNames = new Set<string>();
    walk(ast, (node) => {
      if (node.kind !== 'name') return;
      const n = typeof node.name === 'string' ? node.name : '';
      if (n && !n.includes('\\')) referencedNames.add(n);
    });
    if (!referencedNames.size) return undefined;

    const file = this.index.getFile(document.uri) ?? extractFileIndex(document.uri.toString(), document.getText(), document.version);
    if (!file) return undefined;

    const edit = new vscode.WorkspaceEdit();
    let addedAny = false;
    for (const name of referencedNames) {
      const candidates = this.index.findClassesByName(name);
      if (candidates.length !== 1) continue; // ambiguous or unknown — don't guess
      const importEdit = buildAutoImportEdit(file, document, candidates[0]);
      if (importEdit) {
        edit.insert(document.uri, importEdit.range.start, importEdit.newText);
        addedAny = true;
      }
    }
    if (!addedAny) return undefined;

    const pasteEdit = new vscode.DocumentPasteEdit(
      pastedText,
      'Paste with imports (PHPStorm++)',
      vscode.DocumentDropOrPasteEditKind.TextUpdateImports.append('php')
    );
    pasteEdit.additionalEdit = edit;
    return [pasteEdit];
  }
}
