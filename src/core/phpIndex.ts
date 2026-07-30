import * as vscode from 'vscode';
import { extractFileIndex } from './symbolExtractor';
import { ClassSymbol, FileIndex, FunctionSymbol } from './symbols';

/**
 * Workspace-wide PHP symbol index. Rebuilds a file's symbols whenever it changes
 * and keeps global lookup maps (by FQCN and by simple name) in sync incrementally
 * rather than re-scanning the whole workspace on every edit.
 */
export class PhpIndex implements vscode.Disposable {
  private files = new Map<string, FileIndex>();
  private classesByFqcn = new Map<string, ClassSymbol>();
  private classesByName = new Map<string, ClassSymbol[]>();
  private functionsByName = new Map<string, FunctionSymbol[]>();
  private disposables: vscode.Disposable[] = [];

  private readonly _onDidReindex = new vscode.EventEmitter<void>();
  readonly onDidReindex = this._onDidReindex.event;

  async indexWorkspace(progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
    const uris = await vscode.workspace.findFiles('**/*.php', '**/{node_modules,vendor/**/tests,.git}/**');
    let done = 0;
    for (const uri of uris) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        this.indexDocument(doc, false);
      } catch {
        // unreadable file, skip
      }
      done++;
      if (progress && done % 25 === 0) {
        progress.report({ message: `${done}/${uris.length} files`, increment: (25 / uris.length) * 100 });
      }
    }
    this._onDidReindex.fire();
  }

  indexDocument(document: vscode.TextDocument, notify = true): void {
    if (document.languageId !== 'php') return;
    const key = document.uri.toString();
    const fresh = extractFileIndex(key, document.getText(), document.version);
    if (!fresh) return;
    this.removeFileFromMaps(key);
    this.files.set(key, fresh);
    for (const cls of fresh.classes) {
      this.classesByFqcn.set(cls.fqcn.replace(/^\\/, ''), cls);
      const list = this.classesByName.get(cls.name) ?? [];
      list.push(cls);
      this.classesByName.set(cls.name, list);
    }
    for (const fn of fresh.functions) {
      const list = this.functionsByName.get(fn.name) ?? [];
      list.push(fn);
      this.functionsByName.set(fn.name, list);
    }
    if (notify) this._onDidReindex.fire();
  }

  removeFile(uri: vscode.Uri): void {
    this.removeFileFromMaps(uri.toString());
    this.files.delete(uri.toString());
    this._onDidReindex.fire();
  }

  private removeFileFromMaps(key: string): void {
    const prev = this.files.get(key);
    if (!prev) return;
    for (const cls of prev.classes) {
      this.classesByFqcn.delete(cls.fqcn.replace(/^\\/, ''));
      const list = (this.classesByName.get(cls.name) ?? []).filter((c) => c.uri !== key);
      this.classesByName.set(cls.name, list);
    }
    for (const fn of prev.functions) {
      const list = (this.functionsByName.get(fn.name) ?? []).filter((f) => f.uri !== key);
      this.functionsByName.set(fn.name, list);
    }
  }

  getFile(uri: vscode.Uri): FileIndex | undefined {
    return this.files.get(uri.toString());
  }

  allFiles(): FileIndex[] {
    return [...this.files.values()];
  }

  allClasses(): ClassSymbol[] {
    return [...this.classesByFqcn.values()];
  }

  findClassByFqcn(fqcn: string): ClassSymbol | undefined {
    return this.classesByFqcn.get(fqcn.replace(/^\\/, ''));
  }

  findClassesByName(name: string): ClassSymbol[] {
    return this.classesByName.get(name) ?? [];
  }

  findFunctionsByName(name: string): FunctionSymbol[] {
    return this.functionsByName.get(name) ?? [];
  }

  /** Resolves a possibly-unqualified name used inside `fromFile` to a class symbol,
   * honoring `use` imports and falling back to same-namespace / global lookup —
   * the same resolution order PHP itself applies. */
  resolveClassName(name: string, fromFile: FileIndex): ClassSymbol | undefined {
    if (!name) return undefined;
    const clean = name.replace(/^\\/, '');
    if (clean.includes('\\')) {
      return this.classesByFqcn.get(clean);
    }
    const aliased = fromFile.uses.get(clean);
    if (aliased) {
      const byFqcn = this.classesByFqcn.get(aliased.replace(/^\\/, ''));
      if (byFqcn) return byFqcn;
    }
    if (fromFile.namespace) {
      const nsQualified = this.classesByFqcn.get(`${fromFile.namespace}\\${clean}`);
      if (nsQualified) return nsQualified;
    }
    const candidates = this.classesByName.get(clean);
    if (candidates && candidates.length) return candidates[0];
    return undefined;
  }

  /** Walks the extends chain (as far as we can resolve it) including the class itself. */
  classHierarchy(cls: ClassSymbol): ClassSymbol[] {
    const chain: ClassSymbol[] = [cls];
    let current = cls;
    const seen = new Set([cls.fqcn]);
    while (current.extends.length) {
      const file = this.files.get(current.uri);
      const parent = file ? this.resolveClassName(current.extends[0], file) : this.classesByName.get(current.extends[0])?.[0];
      if (!parent || seen.has(parent.fqcn)) break;
      chain.push(parent);
      seen.add(parent.fqcn);
      current = parent;
    }
    return chain;
  }

  dispose(): void {
    this._onDidReindex.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
