import { parsePhp } from './phpParser';
import { AstNode, docText, locToRange, nameRange, nodeName, typeToString } from './astUtils';
import { ClassSymbol, ConstSymbol, FileIndex, FunctionSymbol, MethodSymbol, ParamSymbol, PropertySymbol } from './symbols';

const CLASS_LIKE = new Set(['class', 'interface', 'trait', 'enum']);

export function extractFileIndex(uri: string, code: string, version: number): FileIndex | undefined {
  const ast = parsePhp(code, uri);
  if (!ast) return undefined;

  const index: FileIndex = {
    uri,
    version,
    namespace: '',
    uses: new Map(),
    useStatements: [],
    classes: [],
    functions: [],
    ast
  };

  processContainer(ast.children ?? [], '', index);
  return index;
}

function processContainer(children: AstNode[], namespace: string, index: FileIndex): void {
  for (const node of children ?? []) {
    if (!node || typeof node !== 'object') continue;
    switch (node.kind) {
      case 'namespace': {
        const ns = typeof node.name === 'string' ? node.name : nodeName(node.name) ?? '';
        processContainer(node.children ?? [], ns, index);
        break;
      }
      case 'usegroup': {
        const prefix: string | null = node.name ?? null;
        const items = node.items ?? [];
        const groupRange = locToRange(node.loc);
        for (const item of items) {
          const full = prefix ? `${prefix}\\${item.name}` : item.name;
          const alias = item.alias ? nodeName(item.alias) ?? full.split('\\').pop()! : full.split('\\').pop()!;
          index.uses.set(alias, full);
          index.useStatements.push({
            alias,
            fqcn: full,
            groupRange,
            itemRange: locToRange(item.loc),
            siblingCount: items.length
          });
        }
        break;
      }
      case 'class':
      case 'interface':
      case 'trait':
      case 'enum': {
        index.namespace = namespace || index.namespace;
        index.classes.push(extractClass(node, namespace, index.uri));
        break;
      }
      case 'function': {
        index.namespace = namespace || index.namespace;
        index.functions.push(extractFunction(node, namespace, index.uri));
        break;
      }
      case 'block': {
        processContainer(node.children ?? [], namespace, index);
        break;
      }
      default:
        break;
    }
  }
}

function extractParams(argNodes: AstNode[]): ParamSymbol[] {
  return (argNodes ?? []).map((p) => ({
    name: nodeName(p.name) ?? String(p.name ?? ''),
    type: typeToString(p.type),
    hasDefault: p.value != null,
    byRef: !!p.byref,
    variadic: !!p.variadic
  }));
}

function extractClass(node: AstNode, namespace: string, uri: string): ClassSymbol {
  const name = nodeName(node.name) ?? 'anonymous';
  const fqcn = namespace ? `${namespace}\\${name}` : name;

  const extendsList: string[] = [];
  if (Array.isArray(node.extends)) {
    for (const e of node.extends) {
      const n = nodeName(e);
      if (n) extendsList.push(n);
    }
  } else if (node.extends) {
    const n = nodeName(node.extends);
    if (n) extendsList.push(n);
  }

  const implementsList: string[] = (node.implements ?? []).map(nodeName).filter(Boolean) as string[];

  const traits: string[] = [];
  const methods: MethodSymbol[] = [];
  const properties: PropertySymbol[] = [];
  const constants: ConstSymbol[] = [];

  for (const member of node.body ?? []) {
    if (!member || typeof member !== 'object') continue;
    switch (member.kind) {
      case 'traituse':
        for (const t of member.traits ?? []) {
          const n = nodeName(t);
          if (n) traits.push(n);
        }
        break;
      case 'method':
        methods.push({
          kind: 'method',
          name: nodeName(member.name) ?? '',
          visibility: member.visibility ?? 'public',
          isStatic: !!member.isStatic,
          isAbstract: !!member.isAbstract,
          params: extractParams(member.arguments),
          returnType: typeToString(member.type),
          range: locToRange(member.loc),
          nameRange: nameRange(member),
          bodyRange: member.body ? locToRange(member.body.loc) : undefined,
          doc: docText(member),
          node: member
        });
        break;
      case 'propertystatement':
        for (const prop of member.properties ?? []) {
          properties.push({
            kind: 'property',
            name: nodeName(prop.name) ?? '',
            visibility: member.visibility ?? 'public',
            isStatic: !!member.isStatic,
            type: typeToString(member.type ?? prop.type),
            range: locToRange(prop.loc),
            nameRange: nameRange(prop),
            doc: docText(member) ?? docText(prop)
          });
        }
        break;
      case 'classconstant':
        for (const c of member.constants ?? []) {
          constants.push({
            kind: 'const',
            name: nodeName(c.name) ?? String(c.name ?? ''),
            range: locToRange(c.loc)
          });
        }
        break;
      default:
        break;
    }
  }

  return {
    kind: node.kind,
    name,
    fqcn,
    namespace,
    extends: extendsList,
    implements: implementsList,
    traits,
    methods,
    properties,
    constants,
    range: locToRange(node.loc),
    nameRange: nameRange(node),
    doc: docText(node),
    uri
  };
}

function extractFunction(node: AstNode, namespace: string, uri: string): FunctionSymbol {
  const name = nodeName(node.name) ?? '';
  return {
    kind: 'function',
    name,
    fqName: namespace ? `${namespace}\\${name}` : name,
    params: extractParams(node.arguments),
    returnType: typeToString(node.type),
    range: locToRange(node.loc),
    nameRange: nameRange(node),
    bodyRange: node.body ? locToRange(node.body.loc) : undefined,
    doc: docText(node),
    uri
  };
}
