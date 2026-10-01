import * as vscode from 'vscode';
import { Engine } from 'php-parser';

/**
 * PHPStorm++'s own PHP formatter.
 *
 * Design goal #1 is *never corrupting code*. Rather than pretty-print from the
 * AST (a full re-emit that can subtly change semantics and is enormous to get
 * right), this is a deliberately conservative *reindenter*: it only ever
 * rewrites the leading whitespace of code lines, trims trailing whitespace, and
 * collapses runs of blank lines. It never reflows or reorders tokens within a
 * line, so the token stream — and therefore the program — is unchanged.
 *
 * Indentation depth is computed from *real* bracket tokens only. Because we
 * tokenize with php-parser (all_tokens), a `{` inside a string or comment is
 * part of a string/comment token, not a punctuation token, so it can't throw
 * the indent off. Lines whose leading whitespace is *significant* — heredoc /
 * nowdoc bodies, multi-line string interiors, and inline HTML (which is literal
 * output) — are "frozen" and passed through byte-for-byte.
 *
 * A final safety net compares the whitespace-stripped input and output; if they
 * differ by anything other than whitespace, the formatter bails and makes no
 * edit at all. So in the worst case a bug means "no formatting", never a
 * mangled file.
 */

export interface FormatOptions {
  tabSize: number;
  insertSpaces: boolean;
  eol: string;
  /** Max consecutive blank lines to keep. Defaults to 1. */
  maxBlankLines?: number;
}

type RawToken = string | [string, string, number];

const tokenEngine = new Engine({
  parser: { suppressErrors: true, php7: true },
  lexer: { all_tokens: true }
} as ConstructorParameters<typeof Engine>[0]);

const OPENERS = new Set(['{', '(', '[']);
const CLOSERS = new Set(['}', ')', ']']);

// Multi-line spans whose interior lines must be passed through untouched: the
// leading whitespace on these lines is part of the program's data/output, not
// indentation we're free to normalize. (Heredoc/nowdoc are handled separately
// with an explicit state machine, because their closing marker is a single-line
// token whose indentation is still significant under PHP 7.3+ flexible syntax.)
const FROZEN_SPAN_TYPES = new Set([
  'T_ENCAPSED_AND_WHITESPACE', // parts of multi-line interpolated strings
  'T_CONSTANT_ENCAPSED_STRING', // '...' / "..." (possibly multi-line)
  'T_COMMENT',
  'T_DOC_COMMENT'
]);

function tokenTypeOf(t: RawToken): string {
  return Array.isArray(t) ? t[0] : 'PUNCT';
}
function tokenTextOf(t: RawToken): string {
  return Array.isArray(t) ? t[1] : t;
}
function countLineBreaks(s: string): number {
  const m = s.match(/\r\n|\r|\n/g);
  return m ? m.length : 0;
}
function endsWithLineBreak(s: string): boolean {
  return /(?:\r\n|\r|\n)$/.test(s);
}
/**
 * The last line that actually holds characters from a token. A token whose text
 * ends in a newline (e.g. a `//` line comment, which php-parser emits *with* its
 * trailing "\n") visually occupies one fewer line than its newline count would
 * suggest — the final break just starts the next line, which is not part of the
 * token and must not be frozen.
 */
function lastContentLine(startLine: number, txt: string): number {
  return startLine + countLineBreaks(txt) - (endsWithLineBreak(txt) ? 1 : 0);
}

/**
 * Format PHP source. Returns the formatted text, or `undefined` when there is
 * nothing to do or when it isn't safe to format (tokenizer failure, or the
 * result would differ from the input by more than whitespace).
 */
export function formatPhp(text: string, options: FormatOptions): string | undefined {
  if (text.length === 0) return undefined;

  let tokens: RawToken[];
  try {
    tokens = tokenEngine.tokenGetAll(text) as unknown as RawToken[];
  } catch {
    return undefined;
  }
  if (!tokens || tokens.length === 0) return undefined;

  const lines = text.split(/\r\n|\r|\n/);
  const n = lines.length;

  const openersOnLine = new Array<number>(n).fill(0);
  const closersOnLine = new Array<number>(n).fill(0);
  const leadingClosersOnLine = new Array<number>(n).fill(0);
  const sawOpenerOnLine = new Array<boolean>(n).fill(false);
  const frozen = new Array<boolean>(n).fill(false);

  // Walk the token stream in source order, tracking the current line by
  // counting the newlines each token's text carries. Punctuation tokens never
  // contain a newline, so a bracket is always attributed to the line we're on.
  let line = 0;
  let inHeredoc = false;
  for (const tok of tokens) {
    const type = tokenTypeOf(tok);
    const txt = tokenTextOf(tok);
    const startLine = line;
    const endLine = startLine + countLineBreaks(txt);

    if (inHeredoc) {
      // Everything from the first body line through the closing marker line is
      // literal string data — freeze every line the heredoc covers, including
      // the single-line closing marker (whose indentation is significant).
      for (let l = startLine; l <= endLine && l < n; l++) frozen[l] = true;
      if (type === 'T_END_HEREDOC') inHeredoc = false;
    } else if (type === 'T_START_HEREDOC') {
      // The opener sits on a normal code line (`$x = <<<EOT`), safe to reindent;
      // its continuation and everything up to the closer is frozen by the
      // inHeredoc branch on subsequent tokens.
      inHeredoc = true;
      for (let l = startLine + 1; l <= lastContentLine(startLine, txt) && l < n; l++) frozen[l] = true;
    } else if (type === 'PUNCT') {
      if (startLine < n && OPENERS.has(txt)) {
        openersOnLine[startLine]++;
        sawOpenerOnLine[startLine] = true;
      } else if (startLine < n && CLOSERS.has(txt)) {
        closersOnLine[startLine]++;
        if (!sawOpenerOnLine[startLine]) leadingClosersOnLine[startLine]++;
      }
    } else if (type === 'T_INLINE_HTML') {
      // Literal output — every line it holds content on (including its first) is frozen.
      for (let l = startLine; l <= lastContentLine(startLine, txt) && l < n; l++) frozen[l] = true;
    } else if (FROZEN_SPAN_TYPES.has(type)) {
      // A multi-line string or block comment: the *continuation* lines that hold
      // content are frozen, but the line it starts on is ordinary code (e.g.
      // `$x = "line1`) and is safe to reindent. A single-line `//` comment ends
      // in a newline yet has no continuation, so this range is empty for it.
      for (let l = startLine + 1; l <= lastContentLine(startLine, txt) && l < n; l++) frozen[l] = true;
    }

    line = endLine;
  }

  const unit = options.insertSpaces ? ' '.repeat(Math.max(1, options.tabSize)) : '\t';
  const out = new Array<string>(n);
  let level = 0;

  for (let i = 0; i < n; i++) {
    const openers = openersOnLine[i];
    const closers = closersOnLine[i];

    if (frozen[i]) {
      out[i] = lines[i];
    } else {
      const trimmed = lines[i].trim();
      if (trimmed === '') {
        out[i] = '';
      } else {
        const indent = Math.max(0, level - leadingClosersOnLine[i]);
        out[i] = unit.repeat(indent) + trimmed;
      }
    }

    // The running level advances by the net real-bracket delta on every line,
    // frozen or not (a frozen line has no real brackets anyway, so this is a
    // no-op there).
    level += openers - closers;
    if (level < 0) level = 0;
  }

  // Collapse runs of blank lines (only where it's safe — never inside a frozen
  // span), and drop trailing blank lines entirely.
  const maxBlank = Math.max(0, options.maxBlankLines ?? 1);
  const collapsed: string[] = [];
  let blankRun = 0;
  for (let i = 0; i < n; i++) {
    const isBlank = out[i] === '' && !frozen[i];
    if (isBlank) {
      blankRun++;
      if (blankRun <= maxBlank) collapsed.push('');
    } else {
      blankRun = 0;
      collapsed.push(out[i]);
    }
  }
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === '') collapsed.pop();

  const eol = options.eol === '\r\n' ? '\r\n' : '\n';
  const result = collapsed.join(eol) + eol;

  // Safety net: only whitespace may have changed. Anything else means a bug —
  // refuse to touch the file rather than risk corrupting it.
  const stripWs = (s: string) => s.replace(/\s+/g, '');
  if (stripWs(result) !== stripWs(text)) return undefined;
  if (result === text) return undefined;

  return result;
}

export class PhpFormattingProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions
  ): vscode.TextEdit[] {
    const maxBlankLines = vscode.workspace
      .getConfiguration('phpstormpp')
      .get<number>('format.maxConsecutiveBlankLines', 1);

    const formatted = formatPhp(document.getText(), {
      tabSize: options.tabSize,
      insertSpaces: options.insertSpaces,
      eol: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
      maxBlankLines
    });
    if (formatted === undefined) return [];

    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    return [vscode.TextEdit.replace(fullRange, formatted)];
  }
}
