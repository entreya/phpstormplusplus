import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';
import { resolveAt } from './positionResolver';
import { ClassSymbol } from '../core/symbols';

function signature(cls: ClassSymbol): string {
  const kw = cls.kind === 'interface' ? 'interface' : cls.kind === 'trait' ? 'trait' : cls.kind === 'enum' ? 'enum' : 'class';
  let s = `${kw} ${cls.fqcn}`;
  if (cls.extends.length) s += ` extends ${cls.extends.join(', ')}`;
  if (cls.implements.length) s += ` implements ${cls.implements.join(', ')}`;
  return s;
}

export class PhpHoverProvider implements vscode.HoverProvider {
  constructor(private index: PhpIndex) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
    const file = this.index.getFile(document.uri);
    if (!file) return;
    const ref = resolveAt(file.ast, position);
    if (!ref) return;

    if (ref.type === 'class') {
      const cls = this.index.resolveClassName(ref.name, file);
      if (!cls) return;
      const md = new vscode.MarkdownString();
      md.appendCodeblock(signature(cls), 'php');
      if (cls.doc) md.appendMarkdown('\n' + cls.doc.replace(/^\/\*\*|\*\/$/g, '').replace(/^\s*\* ?/gm, ''));
      return new vscode.Hover(md, ref.range);
    }

    if (ref.type === 'methodCall' || ref.type === 'staticMember') {
      const name = ref.type === 'methodCall' ? ref.name : ref.name;
      const enclosing = findEnclosingClass(file, position);
      const searchClasses = enclosing ? this.index.classHierarchy(enclosing) : this.index.allClasses();
      for (const cls of searchClasses) {
        const method = cls.methods.find((m) => m.name === name);
        if (method) {
          const params = method.params.map((p) => `${p.type ? p.type + ' ' : ''}$${p.name}`).join(', ');
          const md = new vscode.MarkdownString();
          md.appendCodeblock(
            `${method.visibility}${method.isStatic ? ' static' : ''} function ${method.name}(${params})${method.returnType ? ': ' + method.returnType : ''}`,
            'php'
          );
          md.appendMarkdown(`\ndefined in \`${cls.fqcn}\``);
          return new vscode.Hover(md, ref.range);
        }
      }
    }

    if (ref.type === 'functionCall') {
      const fns = this.index.findFunctionsByName(ref.name);
      if (fns.length) {
        const fn = fns[0];
        const params = fn.params.map((p) => `${p.type ? p.type + ' ' : ''}$${p.name}`).join(', ');
        const md = new vscode.MarkdownString();
        md.appendCodeblock(`function ${fn.name}(${params})${fn.returnType ? ': ' + fn.returnType : ''}`, 'php');
        return new vscode.Hover(md, ref.range);
      }
    }

    return undefined;
  }
}

export function findEnclosingClass(file: { classes: ClassSymbol[] }, position: vscode.Position): ClassSymbol | undefined {
  return file.classes.find((c) => c.range.contains(position));
}
