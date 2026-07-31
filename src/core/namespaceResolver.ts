import * as vscode from 'vscode';

/**
 * Resolves the PSR-4 namespace for a directory by reading composer.json's
 * `autoload.psr-4` (and `autoload-dev.psr-4`) map and finding the mapped base
 * directory that's the longest matching prefix of the target directory —
 * the same resolution PhpStorm and Composer's own autoloader use. Returns ''
 * when no mapping covers the directory (e.g. no composer.json, or the folder
 * is outside every mapped source root).
 */
export async function resolveNamespaceForPath(targetDirUri: vscode.Uri): Promise<string> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetDirUri);
  if (!workspaceFolder) return '';

  let psr4: Record<string, string> = {};
  try {
    const composerUri = vscode.Uri.joinPath(workspaceFolder.uri, 'composer.json');
    const bytes = await vscode.workspace.fs.readFile(composerUri);
    const json = JSON.parse(Buffer.from(bytes).toString('utf8'));
    psr4 = { ...(json.autoload?.['psr-4'] ?? {}), ...(json['autoload-dev']?.['psr-4'] ?? {}) };
  } catch {
    return '';
  }

  const relDir = relativePosix(workspaceFolder.uri, targetDirUri);

  let best: { nsPrefix: string; baseDir: string } | undefined;
  for (const [nsPrefix, rawBaseDir] of Object.entries(psr4)) {
    const baseDir = String(rawBaseDir).replace(/^\.?\/*/, '').replace(/\/+$/, '');
    const matches = relDir === baseDir || relDir.startsWith(baseDir === '' ? '' : `${baseDir}/`);
    if (!matches) continue;
    if (!best || baseDir.length > best.baseDir.length) best = { nsPrefix, baseDir };
  }
  if (!best) return '';

  const remainder = best.baseDir === '' ? relDir : relDir.slice(best.baseDir.length).replace(/^\/+/, '');
  const nsPrefix = best.nsPrefix.replace(/\\+$/, '');
  const remainderNs = remainder ? remainder.split('/').join('\\') : '';
  return remainderNs ? `${nsPrefix}\\${remainderNs}` : nsPrefix;
}

function relativePosix(base: vscode.Uri, target: vscode.Uri): string {
  const baseParts = base.path.replace(/\/+$/, '').split('/');
  const targetParts = target.path.replace(/\/+$/, '').split('/');
  let i = 0;
  while (i < baseParts.length && baseParts[i] === targetParts[i]) i++;
  return targetParts.slice(i).join('/');
}
