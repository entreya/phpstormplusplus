import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { buildSearchRegex, searchTextInFiles, looksLikeTextFile } from '../core/textSearch';

/**
 * Smart Grep's search core.
 *
 * One raw match type, three ways to produce it:
 *   1. ripgrep (`rg`)   — fastest, respects .gitignore, bundled with many setups
 *   2. GNU/BSD `grep`    — the universal POSIX fallback
 *   3. a pure-Node walk  — last resort, so the feature still works where neither
 *                          binary is on PATH (notably a clean Windows box)
 *
 * We deliberately never go through a shell: `spawn(cmd, args[])` passes the
 * pattern and paths as argv entries, so a query containing spaces, quotes, `$`,
 * backticks or `;` can't be reinterpreted as shell syntax. That's both a
 * correctness win (weird queries just work) and the thing that keeps this safe.
 */

export type MatchCategory = 'definition' | 'variable' | 'usage';

export interface RawMatch {
  file: string; // absolute fs path
  line: number; // 1-based (as grep/rg report)
  col: number; // 1-based; 0 when unknown (grep without column support)
  text: string; // the full matched line, trimmed of trailing EOL
}

export interface SmartMatch extends RawMatch {
  category: MatchCategory;
}

export interface SearchSpec {
  /** The user's raw query. */
  query: string;
  /** Regex actually run — a plain substring ("like") match on the escaped
   * query by default, a whole-word match when wholeWord is set, or the query
   * verbatim in regex mode. */
  pattern: string;
  isRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export type SearchEngine = 'ripgrep' | 'grep' | 'node';

export interface SearchResult {
  engine: SearchEngine;
  matches: SmartMatch[];
  truncated: boolean;
}

const MAX_MATCHES = 500;

/**
 * Turn a raw user query into the regex to run. The guiding rule (option A): the
 * query is searched *broadly* and the results are categorized/ranked afterwards
 * (see categorize / groupAndRank). By default a plain identifier is a *substring*
 * ("like") match, so typing `PromoteSt` finds `PromoteStudent`,
 * `PromoteStudentController`, `$promoteStudent`, every call site — not just an
 * exact whole word. Enable `wholeWord` to require an exact word match instead.
 */
export function buildSearchSpec(
  query: string,
  opts?: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }
): SearchSpec {
  const trimmed = query.trim();
  const wholeWord = !!opts?.wholeWord;
  const isRegex = !!opts?.regex || looksLikeRegex(trimmed);
  const caseSensitive = opts?.caseSensitive ?? false;

  let pattern: string;
  if (isRegex) {
    pattern = trimmed;
  } else if (wholeWord && /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    // Opt-in exact match: `grace` won't also hit `graceful`/`disgrace`.
    pattern = `\\b${escapeRegex(trimmed)}\\b`;
  } else {
    // Default: substring match — find the query anywhere, including as a prefix
    // or part of a longer identifier. Ranking floats whole-word hits to the top.
    pattern = escapeRegex(trimmed);
  }
  return { query: trimmed, pattern, isRegex, caseSensitive, wholeWord };
}

/** Heuristic: treat the query as a regex only when it actually contains regex
 * metacharacters the user clearly meant (not a stray `.` in a file name — but
 * we accept the occasional false positive here; regex mode is a superset). */
function looksLikeRegex(q: string): boolean {
  return /[\\^$|?*+()\[\]{}]/.test(q);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Classify one matched line relative to the query. Order matters: a line can
 * contain several forms, and we report the strongest signal.
 *  - definition: `function foo`, `class/interface/trait/enum foo`, `const foo`,
 *                `define('foo'`, or `foo` immediately followed by `(` after a
 *                `function` keyword — i.e. the declaration site.
 *  - variable:   `$foo` appears.
 *  - usage:      anything else that still matched (calls, references, strings).
 */
export function categorize(query: string, lineText: string): MatchCategory {
  const id = query.replace(/^\\b|\\b$/g, '').replace(/[.*+?^${}()|[\]\\]/g, ''); // best-effort bare name
  const safe = escapeRegex(id);
  if (!id) return 'usage';

  // The query may be a *substring* of the actual symbol name (e.g. "PromoteSt"
  // matching `class PromoteStudent`), so allow word chars around it. Classify
  // case-insensitively, matching the default search.
  const defPatterns = [
    new RegExp(`\\bfunction\\s+&?\\s*\\w*${safe}\\w*`, 'i'),
    new RegExp(`\\b(?:class|interface|trait|enum)\\s+\\w*${safe}\\w*`, 'i'),
    new RegExp(`\\bconst\\s+\\w*${safe}\\w*`, 'i'),
    new RegExp(`\\bdefine\\s*\\(\\s*['"]\\w*${safe}\\w*['"]`, 'i')
  ];
  for (const p of defPatterns) if (p.test(lineText)) return 'definition';

  if (new RegExp(`\\$\\w*${safe}\\w*`, 'i').test(lineText)) return 'variable';
  return 'usage';
}

/** Rank for display: definitions first, then variables, then usages; stable
 * within a group by file then line. */
const CATEGORY_ORDER: Record<MatchCategory, number> = { definition: 0, variable: 1, usage: 2 };

export function groupAndRank(matches: SmartMatch[], query?: string): SmartMatch[] {
  // With substring matching, float exact whole-word hits above partial ones
  // within each category — so searching "Promote" lists `Promote` before
  // `PromoteStudentController`.
  const bareName = (query ?? '').replace(/^\\b|\\b$/g, '').replace(/[.*+?^${}()|[\]\\]/g, '');
  const wordRe = bareName ? new RegExp(`\\b${escapeRegex(bareName)}\\b`, 'i') : undefined;
  const wordBoost = (match: SmartMatch): number => (wordRe && wordRe.test(match.text) ? 0 : 1);

  return [...matches].sort(
    (a, b) =>
      CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
      wordBoost(a) - wordBoost(b) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line
  );
}

/** Resolve the directories to search: every workspace folder, plus any extra
 * roots the caller supplies (e.g. resolved symlink targets outside the ws). */
export function searchRoots(extraRoots: string[] = []): string[] {
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  return [...new Set([...folders, ...extraRoots])];
}

/** Which engine to use, cached after first probe. */
let cachedEngine: SearchEngine | undefined;

export async function detectEngine(): Promise<SearchEngine> {
  if (cachedEngine) return cachedEngine;
  if (await canRun('rg', ['--version'])) cachedEngine = 'ripgrep';
  else if (await canRun('grep', ['--version'])) cachedEngine = 'grep';
  else cachedEngine = 'node';
  return cachedEngine;
}

/** For tests: force a specific engine (or clear the cache with undefined). */
export function __setEngineForTest(engine: SearchEngine | undefined): void {
  cachedEngine = engine;
}

function canRun(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { windowsHide: true });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0 || code === 1));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Run the search. Honors a CancellationToken (kills the child / stops the walk)
 * so a fast typist doesn't pile up stale searches. Always resolves — engine
 * failures fall through to the next engine rather than rejecting.
 */
export async function runSmartGrep(
  spec: SearchSpec,
  roots: string[],
  token?: vscode.CancellationToken
): Promise<SearchResult> {
  const engine = await detectEngine();
  let raw: RawMatch[];
  let used: SearchEngine = engine;

  try {
    if (engine === 'ripgrep') raw = await runRipgrep(spec, roots, token);
    else if (engine === 'grep') raw = await runGrep(spec, roots, token);
    else raw = await runNode(spec, roots, token);
  } catch {
    // Spawn-based engine blew up at runtime — fall back to the Node walker,
    // which has no external dependency and can't be "not installed".
    used = 'node';
    raw = await runNode(spec, roots, token);
  }

  const truncated = raw.length > MAX_MATCHES;
  const matches: SmartMatch[] = raw.slice(0, MAX_MATCHES).map((m) => ({ ...m, category: categorize(spec.query, m.text) }));
  return { engine: used, matches: groupAndRank(matches, spec.query), truncated };
}

const COMMON_EXCLUDES = ['node_modules', '.git', 'vendor', 'runtime', 'web/assets'];

function runRipgrep(spec: SearchSpec, roots: string[], token?: vscode.CancellationToken): Promise<RawMatch[]> {
  const args = ['--no-heading', '--line-number', '--column', '--color', 'never', '--type', 'php'];
  if (!spec.caseSensitive) args.push('--ignore-case');
  for (const ex of COMMON_EXCLUDES) args.push('--glob', `!${ex}/`);
  args.push('--max-count', String(MAX_MATCHES), spec.pattern, ...roots);
  return spawnMatches('rg', args, token, parseRgLine);
}

function runGrep(spec: SearchSpec, roots: string[], token?: vscode.CancellationToken): Promise<RawMatch[]> {
  // -r recursive, -n line numbers, -E extended regex, -I skip binary, --include
  // limits to PHP, --exclude-dir prunes the heavy dirs. BSD grep (macOS) and GNU
  // grep both accept this set.
  const args = ['-rnEI', '--include=*.php', '--include=*.phtml'];
  if (!spec.caseSensitive) args.push('-i');
  for (const ex of COMMON_EXCLUDES) args.push(`--exclude-dir=${ex.split('/').pop()}`);
  args.push(spec.pattern, ...roots);
  return spawnMatches('grep', args, token, parseGrepLine);
}

function spawnMatches(
  cmd: string,
  args: string[],
  token: vscode.CancellationToken | undefined,
  parse: (line: string) => RawMatch | undefined
): Promise<RawMatch[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    const out: RawMatch[] = [];
    let buf = '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const cancel = token?.onCancellationRequested(() => {
      child.kill();
      finish(() => resolve(out));
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const m = parse(line);
        if (m) out.push(m);
        if (out.length >= MAX_MATCHES) {
          child.kill();
          finish(() => resolve(out));
          return;
        }
      }
    });
    child.on('error', (e) => finish(() => reject(e)));
    child.on('close', () => {
      cancel?.dispose();
      if (buf) {
        const m = parse(buf);
        if (m) out.push(m);
      }
      finish(() => resolve(out));
    });
  });
}

/** rg --column format: `path:line:col:text` */
export function parseRgLine(line: string): RawMatch | undefined {
  const m = /^(.*?):(\d+):(\d+):(.*)$/.exec(line);
  if (!m) return undefined;
  return { file: m[1], line: Number(m[2]), col: Number(m[3]), text: m[4] };
}

/** grep -n format: `path:line:text` (no column). */
export function parseGrepLine(line: string): RawMatch | undefined {
  const m = /^(.*?):(\d+):(.*)$/.exec(line);
  if (!m) return undefined;
  return { file: m[1], line: Number(m[2]), col: 0, text: m[3] };
}

/** Pure-Node fallback: reuse the existing content searcher over PHP files found
 * via VS Code's own file enumeration (which can't reach symlink targets, but
 * the two spawn engines do, so this is only hit when no binary exists at all). */
async function runNode(spec: SearchSpec, _roots: string[], token?: vscode.CancellationToken): Promise<RawMatch[]> {
  const regex = buildSearchRegex(spec.pattern, true, spec.caseSensitive);
  if (!regex) return [];
  const files = (await vscode.workspace.findFiles('**/*.{php,phtml}', '**/{node_modules,.git,vendor}/**', 20000)).filter(looksLikeTextFile);
  if (token?.isCancellationRequested) return [];
  const matches = await searchTextInFiles(regex, files, MAX_MATCHES);
  return matches.map((m) => ({ file: m.uri.fsPath, line: m.line + 1, col: 0, text: m.lineText }));
}
