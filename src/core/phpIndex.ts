import * as vscode from 'vscode';
import { extractFileIndex } from './symbolExtractor';
import { ClassSymbol, FileIndex, FunctionSymbol } from './symbols';
import { CachedFileEntry, deserializeFileIndex, loadCache, saveCache, serializeFileIndex } from './indexCache';

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

  private static readonly VENDOR_EXCLUDE = '**/{node_modules,.git,vendor/**/{tests,Tests,test,Test,docs,doc,examples,example,bin}}/**';

  /** Disk-persisted per-file cache (mtime + serialized FileIndex), so a fresh
   * VS Code session can skip re-parsing files that haven't changed since the
   * last one — the expensive part of indexing is parsing, not the file list. */
  private diskCache = new Map<string, CachedFileEntry>();
  private cacheDirty = false;

  async loadDiskCache(storageDir: vscode.Uri | undefined): Promise<void> {
    this.diskCache = storageDir ? await loadCache(storageDir) : new Map();
  }

  async flushDiskCache(storageDir: vscode.Uri | undefined): Promise<void> {
    if (!storageDir || !this.cacheDirty) return;
    await saveCache(storageDir, this.diskCache);
    this.cacheDirty = false;
  }

  private async scanFiles(
    uris: vscode.Uri[],
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    label = 'files',
    yieldEvery = 40
  ): Promise<{ scanned: number; fromCache: number }> {
    let done = 0;
    let fromCache = 0;
    for (const uri of uris) {
      const key = uri.toString();
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        const cached = this.diskCache.get(key);
        if (cached && cached.mtimeMs === stat.mtime) {
          this.indexParsedFile(deserializeFileIndex(cached.data), false);
          fromCache++;
        } else {
          // Reads raw bytes rather than opening each file as a live vscode.TextDocument —
          // much lighter when vendor/ has thousands of files.
          const bytes = await vscode.workspace.fs.readFile(uri);
          this.applyFileIndex(key, Buffer.from(bytes).toString('utf8'), 0, false, stat.mtime);
        }
      } catch {
        // unreadable file, skip
      }
      done++;
      if (done % yieldEvery === 0) {
        progress?.report({ message: `${label}: ${done}/${uris.length}`, increment: (yieldEvery / uris.length) * 100 });
        this._onDidReindex.fire();
        // Yield to the event loop periodically so a big background scan never
        // blocks typing, completion, or anything else the user is doing.
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    return { scanned: done, fromCache };
  }

  /** Fast foreground scan of the project's own PHP files (vendor/ excluded). Small
   * and quick enough on any real project to await directly during activation. */
  async indexWorkspace(
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<{ scanned: number; fromCache: number }> {
    const uris = await vscode.workspace.findFiles('**/*.php', '**/{node_modules,.git,vendor}/**');
    const result = await this.scanFiles(uris, progress, 'project files');
    this._onDidReindex.fire();
    return result;
  }

  /**
   * Scans vendor/ (framework + dependency source) in the background, in small
   * yielding batches, firing onDidReindex as it goes so completion/hover pick up
   * newly-discovered classes progressively. Never awaited by activate() — a huge
   * vendor tree takes longer, but no longer blocks startup or the editor at all.
   * Unchanged vendor files (the common case — dependencies rarely change) load
   * straight from the disk cache instead of being re-parsed.
   */
  async indexVendorInBackground(onDone?: (scanned: number, fromCache: number) => void): Promise<void> {
    const uris = await vscode.workspace.findFiles('vendor/**/*.php', PhpIndex.VENDOR_EXCLUDE);
    const result = await this.scanFiles(uris, undefined, 'vendor/');
    this._onDidReindex.fire();
    onDone?.(result.scanned, result.fromCache);
  }

  indexDocument(document: vscode.TextDocument, notify = true): void {
    if (document.languageId !== 'php') return;
    this.applyFileIndex(document.uri.toString(), document.getText(), document.version, notify);
  }

  private applyFileIndex(key: string, text: string, version: number, notify: boolean, mtimeMs?: number): void {
    const fresh = extractFileIndex(key, text, version);
    if (!fresh) return;
    this.indexParsedFile(fresh, notify);
    // Only cache files we actually know the real on-disk mtime for (the bulk
    // scan path) — live-editing saves go through indexDocument, which doesn't
    // have a fresh mtime handy and will simply be treated as "changed" (a
    // cache miss) next session, which is correct and harmless.
    if (mtimeMs !== undefined) {
      this.diskCache.set(key, { mtimeMs, data: serializeFileIndex(fresh) });
      this.cacheDirty = true;
    }
  }

  private indexParsedFile(fresh: FileIndex, notify: boolean): void {
    const key = fresh.uri;
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
    const key = uri.toString();
    this.removeFileFromMaps(key);
    this.files.delete(key);
    if (this.diskCache.delete(key)) this.cacheDirty = true;
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
    // Per PHP's own resolution rules, an unqualified name with no matching `use`
    // and no match in the current namespace refers to the global namespace —
    // not an arbitrarily-chosen same-named class from somewhere else entirely.
    const global = this.classesByFqcn.get(clean);
    if (global) return global;

    // Last-resort best-effort guess for navigation convenience (e.g. code
    // referencing a class it forgot to `use`). Sorted for determinism — this
    // used to be `candidates[0]`, which depended on indexing/scan order and
    // could silently point at a different same-named class between sessions.
    const candidates = this.classesByName.get(clean);
    if (candidates && candidates.length) {
      return [...candidates].sort((a, b) => a.fqcn.localeCompare(b.fqcn))[0];
    }
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
