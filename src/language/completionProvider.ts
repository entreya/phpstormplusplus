import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';
import { extractFileIndex } from '../core/symbolExtractor';
import { inferVariableClass } from './typeInference';
import { ClassSymbol } from '../core/symbols';

const PHP_KEYWORDS = [
  'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch', 'class', 'clone', 'const', 'continue',
  'declare', 'default', 'do', 'echo', 'else', 'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach', 'endif',
  'endswitch', 'endwhile', 'enum', 'extends', 'final', 'finally', 'fn', 'for', 'foreach', 'function', 'global',
  'goto', 'if', 'implements', 'include', 'include_once', 'instanceof', 'insteadof', 'interface', 'isset', 'list',
  'match', 'namespace', 'new', 'or', 'print', 'private', 'protected', 'public', 'readonly', 'require', 'require_once',
  'return', 'static', 'switch', 'throw', 'trait', 'try', 'unset', 'use', 'var', 'while', 'xor', 'yield'
];

function memberItems(cls: ClassSymbol, staticOnly: boolean): vscode.CompletionItem[] {
  const items: vscode.CompletionItem[] = [];
  for (const m of cls.methods) {
    if (staticOnly && !m.isStatic) continue;
    const params = m.params.map((p) => `${p.type ? p.type + ' ' : ''}$${p.name}`).join(', ');
    const item = new vscode.CompletionItem(m.name, vscode.CompletionItemKind.Method);
    item.detail = `${m.visibility}${m.isStatic ? ' static' : ''} function ${m.name}(${params})${m.returnType ? ': ' + m.returnType : ''}`;
    item.insertText = new vscode.SnippetString(`${m.name}($0)`);
    items.push(item);
  }
  for (const p of cls.properties) {
    if (staticOnly && !p.isStatic) continue;
    const item = new vscode.CompletionItem(p.name, vscode.CompletionItemKind.Property);
    item.detail = `${p.visibility}${p.isStatic ? ' static' : ''} $${p.name}${p.type ? ': ' + p.type : ''}`;
    items.push(item);
  }
  if (staticOnly) {
    for (const c of cls.constants) {
      items.push(new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Constant));
    }
  }
  return items;
}

export class PhpCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private index: PhpIndex) {}

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.CompletionItem[]> {
    const file = extractFileIndex(document.uri.toString(), document.getText(), document.version) ?? this.index.getFile(document.uri);
    if (!file) return [];

    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);

    const objectAccess = /\$(\w+)\s*->\s*(\w*)$/.exec(linePrefix);
    if (objectAccess) {
      const varName = objectAccess[1];
      const cls = inferVariableClass(this.index, file, position, varName);
      if (!cls) return [];
      const seen = new Map<string, vscode.CompletionItem>();
      for (const c of this.index.classHierarchy(cls)) {
        for (const item of memberItems(c, false)) if (!seen.has(item.label as string)) seen.set(item.label as string, item);
      }
      return [...seen.values()];
    }

    const staticAccess = /(\w+)\s*::\s*(\w*)$/.exec(linePrefix);
    if (staticAccess) {
      const className = staticAccess[1];
      const enclosing = file.classes.find((c) => c.range.contains(position));
      const cls =
        className === 'self' || className === 'static'
          ? enclosing
          : className === 'parent' && enclosing?.extends.length
            ? this.index.resolveClassName(enclosing.extends[0], file)
            : this.index.resolveClassName(className, file);
      if (!cls) return [];
      const seen = new Map<string, vscode.CompletionItem>();
      for (const c of this.index.classHierarchy(cls)) {
        for (const item of memberItems(c, true)) if (!seen.has(item.label as string)) seen.set(item.label as string, item);
      }
      return [...seen.values()];
    }

    const newExpr = /\bnew\s+(\w*)$/.exec(linePrefix);
    if (newExpr) {
      return this.index.allClasses().map((cls) => {
        const item = new vscode.CompletionItem(cls.name, vscode.CompletionItemKind.Class);
        item.detail = cls.fqcn;
        item.insertText = new vscode.SnippetString(`${cls.name}($0)`);
        return item;
      });
    }

    const items: vscode.CompletionItem[] = PHP_KEYWORDS.map((k) => new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword));
    for (const cls of this.index.allClasses()) {
      const item = new vscode.CompletionItem(cls.name, vscode.CompletionItemKind.Class);
      item.detail = cls.fqcn;
      items.push(item);
    }
    for (const [name] of uniqueFunctionNames(this.index)) {
      items.push(new vscode.CompletionItem(name, vscode.CompletionItemKind.Function));
    }
    return items;
  }
}

function uniqueFunctionNames(index: PhpIndex): Map<string, true> {
  const map = new Map<string, true>();
  for (const f of index.allFiles()) {
    for (const fn of f.functions) map.set(fn.name, true);
  }
  return map;
}
