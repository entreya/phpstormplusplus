import * as vscode from 'vscode';
import { FileIndex } from './symbols';

/**
 * Bump this whenever FileIndex/ClassSymbol/etc. change shape. A version
 * mismatch discards the whole cache rather than risk loading data that no
 * longer matches what the rest of the extension expects.
 */
const CACHE_VERSION = 1;
const CACHE_FILE_NAME = 'php-index-cache.json';

export interface CachedFileEntry {
  mtimeMs: number;
  /** JSON.stringify of a FileIndex — `uses` (a Map) is stored as an entry
   * array; vscode.Range/Position instances serialize to their plain
   * {start,end}/{line,character} shape automatically and get reconstructed
   * on load by `revive`. */
  data: any;
}

interface CacheFile {
  version: number;
  entries: Record<string, CachedFileEntry>;
}

/** Reconstructs vscode.Position/Range instances from their plain JSON shape,
 * bottom-up so nested Positions are revived before the Range wrapping them
 * is checked. Note vscode.Range's own toJSON() serializes as the 2-element
 * array `[start, end]`, not `{start, end}` — its `_start`/`_end` fields are
 * private and never reach JSON.stringify directly. Everything else
 * (including the php-parser AST, whose `loc` objects use `column`/`offset`
 * rather than `character` and so never match) passes through unchanged. */
function revive(value: any): any {
  if (Array.isArray(value)) {
    const mapped = value.map(revive);
    if (mapped.length === 2 && mapped[0] instanceof vscode.Position && mapped[1] instanceof vscode.Position) {
      return new vscode.Range(mapped[0], mapped[1]);
    }
    return mapped;
  }
  if (value === null || typeof value !== 'object') return value;

  const revived: any = {};
  for (const key of Object.keys(value)) revived[key] = revive(value[key]);

  const keys = Object.keys(revived);
  if (keys.length === 2 && typeof revived.line === 'number' && typeof revived.character === 'number') {
    return new vscode.Position(revived.line, revived.character);
  }
  return revived;
}

export function serializeFileIndex(index: FileIndex): any {
  return { ...index, uses: [...index.uses.entries()] };
}

export function deserializeFileIndex(data: any): FileIndex {
  const revived = revive(data);
  return { ...revived, uses: new Map(revived.uses) };
}

function cacheFileUri(storageDir: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(storageDir, CACHE_FILE_NAME);
}

export async function loadCache(storageDir: vscode.Uri): Promise<Map<string, CachedFileEntry>> {
  try {
    const bytes = await vscode.workspace.fs.readFile(cacheFileUri(storageDir));
    const parsed: CacheFile = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (parsed.version !== CACHE_VERSION) return new Map();
    return new Map(Object.entries(parsed.entries));
  } catch {
    return new Map();
  }
}

export async function saveCache(storageDir: vscode.Uri, entries: Map<string, CachedFileEntry>): Promise<void> {
  try {
    await vscode.workspace.fs.createDirectory(storageDir);
    const payload: CacheFile = { version: CACHE_VERSION, entries: Object.fromEntries(entries) };
    await vscode.workspace.fs.writeFile(cacheFileUri(storageDir), Buffer.from(JSON.stringify(payload), 'utf8'));
  } catch {
    // Best-effort — a failed cache write just means the next session re-parses from scratch.
  }
}
