import * as vscode from 'vscode';
import { walk } from '../core/astUtils';
import { PhpIndex } from '../core/phpIndex';
import { ClassSymbol, FileIndex, UseStatement } from '../core/symbols';

function clean(fqcn: string): string {
  return fqcn.replace(/^\\/, '');
}

/** Finds where a new `use` statement should go: after the last existing one,
 * otherwise right after `namespace ...;`, otherwise right after `<?php`. */
function findInsertionPoint(document: vscode.TextDocument): { line: number; blankLineBefore: boolean } {
  let lastUseLine = -1;
  let namespaceLine = -1;
  let openTagLine = 0;

  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;
    if (/^use\s+/.test(text)) lastUseLine = i;
    if (/^namespace\s+/.test(text)) namespaceLine = i;
    if (openTagLine === 0 && /<\?php/.test(text)) openTagLine = i;
    if (/^(abstract\s+|final\s+)?(class|interface|trait|enum|function)\s/.test(text)) break;
  }

  if (lastUseLine >= 0) return { line: lastUseLine + 1, blankLineBefore: false };
  if (namespaceLine >= 0) return { line: namespaceLine + 1, blankLineBefore: true };
  return { line: openTagLine + 1, blankLineBefore: true };
}

/**
 * Builds the edit that imports `cls` into `document`, PhpStorm-style: a `use`
 * statement inserted near the top, so the class can be referenced by its
 * simple name. Returns undefined when no import is needed (same namespace,
 * already imported) or when the simple name is already taken by a different
 * import (to avoid silently shadowing something the file already relies on).
 */
export function buildAutoImportEdit(file: FileIndex, document: vscode.TextDocument, cls: ClassSymbol): vscode.TextEdit | undefined {
  if (clean(cls.namespace) === clean(file.namespace)) return undefined;

  for (const fqcn of file.uses.values()) {
    if (clean(fqcn) === clean(cls.fqcn)) return undefined;
  }
  const existingAlias = file.uses.get(cls.name);
  if (existingAlias && clean(existingAlias) !== clean(cls.fqcn)) return undefined;

  const { line, blankLineBefore } = findInsertionPoint(document);
  const text = blankLineBefore ? `\nuse ${cls.fqcn};\n` : `use ${cls.fqcn};\n`;
  return vscode.TextEdit.insert(new vscode.Position(line, 0), text);
}

/** True if `alias` is referenced anywhere in the file outside of `use` statements themselves. */
function isReferenced(file: FileIndex, alias: string): boolean {
  let found = false;
  walk(file.ast, (node) => {
    if (found || node.kind !== 'name') return;
    const first = (typeof node.name === 'string' ? node.name : '').replace(/^\\/, '').split('\\')[0];
    if (first === alias) found = true;
  });
  return found;
}

/** Cheap textual fallback so we don't flag imports only used inside PHPDoc
 * (`@var Foo`, `@param Foo`) as unused — the AST walk above only sees real code. */
function mentionedInComments(document: vscode.TextDocument, alias: string, ownRange: vscode.Range): boolean {
  const pattern = new RegExp(`[^a-zA-Z0-9_\\\\]${alias}[^a-zA-Z0-9_]`);
  for (let i = 0; i < document.lineCount; i++) {
    if (i >= ownRange.start.line && i <= ownRange.end.line) continue;
    const text = document.lineAt(i).text;
    if (/\/\/|\/\*|\*/.test(text) && pattern.test(text)) return true;
  }
  return false;
}

export function findUnusedImports(file: FileIndex, document: vscode.TextDocument): UseStatement[] {
  return file.useStatements.filter((u) => !isReferenced(file, u.alias) && !mentionedInComments(document, u.alias, u.groupRange));
}

/** Deletes a single unused import: the whole line for a one-per-line `use`,
 * or just this item (plus its separator) out of a grouped `use A, B;`. */
export function buildRemoveImportEdit(document: vscode.TextDocument, useStmt: UseStatement): vscode.TextEdit {
  if (useStmt.siblingCount <= 1) {
    const line = useStmt.groupRange.start.line;
    const range = new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line + 1, 0));
    return vscode.TextEdit.delete(range);
  }

  const lineText = document.lineAt(useStmt.itemRange.start.line).text;
  const start = useStmt.itemRange.start.character;
  const end = useStmt.itemRange.end.character;
  const before = lineText.slice(0, start);
  const after = lineText.slice(end);
  // consume a trailing ", " if present, else a leading ", "
  const range = /^\s*,\s*/.test(after)
    ? new vscode.Range(useStmt.itemRange.start, new vscode.Position(useStmt.itemRange.end.line, end + after.match(/^\s*,\s*/)![0].length))
    : /,\s*$/.test(before)
      ? new vscode.Range(
          new vscode.Position(useStmt.itemRange.start.line, start - before.match(/,\s*$/)![0].length),
          useStmt.itemRange.end
        )
      : useStmt.itemRange;
  return vscode.TextEdit.delete(range);
}

export async function optimizeImports(editor: vscode.TextEditor, index: PhpIndex): Promise<void> {
  const file = index.getFile(editor.document.uri);
  if (!file) return;
  const unused = findUnusedImports(file, editor.document);
  if (!unused.length) {
    vscode.window.showInformationMessage('PHPStorm++: no unused imports found.');
    return;
  }
  const edits = unused.map((u) => buildRemoveImportEdit(editor.document, u));
  edits.sort((a, b) => b.range.start.compareTo(a.range.start));
  await editor.edit((builder) => {
    for (const e of edits) builder.delete(e.range);
  });
}
