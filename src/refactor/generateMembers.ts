import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';
import { ClassSymbol } from '../core/symbols';

function findEnclosingClass(index: PhpIndex, document: vscode.TextDocument, position: vscode.Position): ClassSymbol | undefined {
  const file = index.getFile(document.uri);
  return file?.classes.find((c) => c.range.contains(position));
}

function insertionPointForNewMember(cls: ClassSymbol): vscode.Position {
  // Insert right before the class's closing brace, i.e. at the class range's end line.
  return new vscode.Position(cls.range.end.line, 0);
}

export async function generateConstructor(editor: vscode.TextEditor, index: PhpIndex): Promise<void> {
  const cls = findEnclosingClass(index, editor.document, editor.selection.active);
  if (!cls) {
    vscode.window.showWarningMessage('PHPStorm++: place the cursor inside a class first.');
    return;
  }
  if (cls.methods.some((m) => m.name === '__construct')) {
    vscode.window.showInformationMessage('PHPStorm++: this class already has a constructor.');
    return;
  }
  if (!cls.properties.length) {
    vscode.window.showInformationMessage('PHPStorm++: this class has no properties to initialize.');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    cls.properties.map((p) => ({ label: `$${p.name}`, description: p.type, picked: true, prop: p })),
    { canPickMany: true, title: 'Select properties to initialize in the constructor' }
  );
  if (!picked || !picked.length) return;

  const indent = '    ';
  const params = picked.map((p) => `${p.prop.type ? p.prop.type + ' ' : ''}$${p.prop.name}`).join(', ');
  const body = picked.map((p) => `${indent}    $this->${p.prop.name} = $${p.prop.name};`).join('\n');
  const method = `\n${indent}public function __construct(${params})\n${indent}{\n${body}\n${indent}}\n`;

  await editor.edit((builder) => builder.insert(insertionPointForNewMember(cls), method));
}

export async function generateGettersSetters(editor: vscode.TextEditor, index: PhpIndex): Promise<void> {
  const cls = findEnclosingClass(index, editor.document, editor.selection.active);
  if (!cls) {
    vscode.window.showWarningMessage('PHPStorm++: place the cursor inside a class first.');
    return;
  }
  if (!cls.properties.length) {
    vscode.window.showInformationMessage('PHPStorm++: this class has no properties.');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    cls.properties.map((p) => ({ label: `$${p.name}`, description: p.type, picked: true, prop: p })),
    { canPickMany: true, title: 'Select properties to generate getters/setters for' }
  );
  if (!picked || !picked.length) return;

  const indent = '    ';
  const existingMethodNames = new Set(cls.methods.map((m) => m.name.toLowerCase()));
  const chunks: string[] = [];
  for (const { prop } of picked) {
    const pascalName = prop.name.charAt(0).toUpperCase() + prop.name.slice(1);
    const type = prop.type ? prop.type : 'mixed';

    if (!existingMethodNames.has(`get${pascalName}`.toLowerCase())) {
      chunks.push(
        `\n${indent}public function get${pascalName}()${prop.type ? ': ' + prop.type : ''}\n${indent}{\n${indent}    return $this->${prop.name};\n${indent}}\n`
      );
    }
    if (!existingMethodNames.has(`set${pascalName}`.toLowerCase())) {
      chunks.push(
        `\n${indent}public function set${pascalName}(${prop.type ? prop.type + ' ' : ''}$${prop.name}): void\n${indent}{\n${indent}    $this->${prop.name} = $${prop.name};\n${indent}}\n`
      );
    }
    void type;
  }

  if (!chunks.length) {
    vscode.window.showInformationMessage('PHPStorm++: getters and setters already exist for the selected properties.');
    return;
  }

  await editor.edit((builder) => builder.insert(insertionPointForNewMember(cls), chunks.join('')));
}
