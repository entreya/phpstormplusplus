import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

/**
 * VS Code's own file watcher does not follow symlinks, and `findFiles` doesn't
 * cross them either — so a workspace that pulls its real source in through
 * symlinked directories (e.g. Composer path repositories wiring
 * `vendor/uims/* -> ../../submodules/uims_*`, a very common monorepo-ish PHP
 * setup) gets no create/change events and no indexing for anything living
 * behind those links. The files are physically outside the workspace folder;
 * the link is the only thing that makes them "inside".
 *
 * This module finds those symlinked directories and resolves them to their real
 * on-disk targets, so the extension can put its *own* fs.watch watchers on the
 * real paths (which DO see changes) and index what lives there. It's capability
 * detection, not configuration: the user doesn't have to set up a multi-root
 * workspace or flip followSymlinks for their own source to be understood.
 */

export interface SymlinkRoot {
  /** The symlink inside the workspace, e.g. <ws>/vendor/uims/evaluation */
  linkUri: vscode.Uri;
  /** Its resolved real target, e.g. /abs/submodules/uims_evaluation */
  realPath: string;
}

/**
 * Shallow-scan the workspace folders for directory symlinks whose target is a
 * real directory, resolving each to its canonical path. Two layers deep from a
 * folder root covers the conventional vendor/<vendor>/<pkg> layout as well as
 * top-level links, which catches the usual link locations without walking the
 * entire tree (which would defeat the point).
 */
export async function discoverSymlinkRoots(folders: readonly vscode.WorkspaceFolder[]): Promise<SymlinkRoot[]> {
  const found = new Map<string, SymlinkRoot>(); // keyed by realPath, de-duped

  const considerEntry = async (dir: string, name: string): Promise<void> => {
    const linkPath = path.join(dir, name);
    try {
      const lst = await fsp.lstat(linkPath);
      if (!lst.isSymbolicLink()) return;
      const real = await fsp.realpath(linkPath);
      const realStat = await fsp.stat(real); // follows the link; throws if dangling
      if (!realStat.isDirectory()) return;
      // Ignore links that resolve to somewhere still inside a workspace folder —
      // those are already covered by the normal watcher/scan.
      if (folders.some((f) => isInside(f.uri.fsPath, real))) return;
      if (!found.has(real)) found.set(real, { linkUri: vscode.Uri.file(linkPath), realPath: real });
    } catch {
      // dangling link, permission error, etc. — skip
    }
  };

  const scanDir = async (dir: string, depth: number): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // A symlink shows up here as a symlink dirent — check it directly.
      if (entry.isSymbolicLink()) {
        await considerEntry(dir, entry.name);
        continue;
      }
      // Recurse into real subdirectories only to the shallow depth that covers
      // vendor/<vendor>/<pkg>, skipping the heavy well-known noise dirs.
      if (entry.isDirectory() && depth > 0 && !SKIP_DIRS.has(entry.name)) {
        await scanDir(path.join(dir, entry.name), depth - 1);
      }
    }
  };

  for (const folder of folders) {
    await scanDir(folder.uri.fsPath, 2);
  }
  return [...found.values()];
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'web', 'runtime', 'tests', 'test']);

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
