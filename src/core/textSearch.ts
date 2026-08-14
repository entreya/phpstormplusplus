import * as vscode from 'vscode';

const TEXT_SEARCH_EXTENSIONS = new Set([
  '.php', '.phtml', '.js', '.jsx', '.ts', '.tsx', '.json', '.twig', '.html', '.htm', '.css', '.scss', '.md', '.yml',
  '.yaml', '.env', '.txt', '.xml', '.sql', '.blade.php'
]);
const CONTENT_SEARCH_MAX_FILES = 4000;
const CONTENT_SEARCH_MAX_MATCHES = 200;
const CONTENT_SEARCH_BATCH_SIZE = 25;

export function looksLikeTextFile(uri: vscode.Uri): boolean {
  const path = uri.path.toLowerCase();
  for (const ext of TEXT_SEARCH_EXTENSIONS) {
    if (path.endsWith(ext)) return true;
  }
  return false;
}

/** Builds the RegExp a search query should be matched with: raw as typed in
 * regex mode (undefined if invalid), otherwise every regex metacharacter
 * escaped so plain text search means exactly what it looks like. Never
 * includes the 'g' flag — matches are tested per line with a fresh `.test()`
 * call each time, and a global flag's stateful lastIndex would corrupt that
 * across repeated calls on the same RegExp instance. */
export function buildSearchRegex(query: string, useRegex: boolean, caseSensitive = false): RegExp | undefined {
  const flags = caseSensitive ? '' : 'i';
  try {
    if (useRegex) return new RegExp(query, flags);
    return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  } catch {
    return undefined;
  }
}

export interface TextMatch {
  uri: vscode.Uri;
  line: number;
  lineText: string;
}

/** Scans file contents for a regex match — the one thing name/symbol matching
 * can never find (a log message, a string literal, a comment, ...). Reads in
 * small concurrent batches so it doesn't serialize thousands of individual
 * file reads one at a time. Shared by Search Everywhere and the file
 * explorer's Find in Files box so there's one implementation of "scan the
 * workspace for a pattern" rather than two. */
export async function searchTextInFiles(regex: RegExp, files: vscode.Uri[], maxMatches = CONTENT_SEARCH_MAX_MATCHES): Promise<TextMatch[]> {
  const matches: TextMatch[] = [];
  const limit = Math.min(files.length, CONTENT_SEARCH_MAX_FILES);

  for (let start = 0; start < limit && matches.length < maxMatches; start += CONTENT_SEARCH_BATCH_SIZE) {
    const batch = files.slice(start, start + CONTENT_SEARCH_BATCH_SIZE);
    const reads = await Promise.all(
      batch.map(async (uri) => {
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          return { uri, text: Buffer.from(bytes).toString('utf8') };
        } catch {
          return undefined;
        }
      })
    );
    for (const read of reads) {
      if (!read) continue;
      const lines = read.text.split('\n');
      for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
        if (!regex.test(lines[i])) continue;
        matches.push({ uri: read.uri, line: i, lineText: lines[i].trim().slice(0, 200) });
      }
    }
  }
  return matches;
}
