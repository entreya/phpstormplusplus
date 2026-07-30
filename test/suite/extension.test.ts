import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const fixtures = path.resolve(__dirname, '../../test-fixtures');

async function openDoc(relPath: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument(path.join(fixtures, relPath));
  await vscode.window.showTextDocument(doc);
  return doc;
}

suite('PHPStorm++ extension', () => {
  suiteSetup(async function () {
    this.timeout(60000);
    const ext = vscode.extensions.getExtension('phpstormplusplus.phpstormplusplus');
    assert.ok(ext, 'extension should be discoverable');
    await ext!.activate();
    // Give the workspace indexer + framework detection a moment after activation.
    await openDoc('src/User.php');
    await openDoc('src/Usage.php');
    await new Promise((r) => setTimeout(r, 1500));
  });

  test('indexes classes and resolves hover on a class reference', async () => {
    const doc = await openDoc('src/Usage.php');
    const text = doc.getText();
    const idx = text.indexOf('User(');
    const position = doc.positionAt(idx);
    const hovers = (await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, position)) as vscode.Hover[];
    assert.ok(hovers.length > 0, 'expected at least one hover result');
    const content = hovers[0].contents.map((c) => (typeof c === 'string' ? c : (c as vscode.MarkdownString).value)).join('\n');
    assert.match(content, /App\\Models\\User/);
  });

  test('go to definition jumps from usage to class declaration', async () => {
    const doc = await openDoc('src/Usage.php');
    const text = doc.getText();
    const position = doc.positionAt(text.indexOf('User('));
    const locations = (await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      doc.uri,
      position
    )) as vscode.Location[];
    assert.ok(locations.length > 0, 'expected a definition location');
    assert.match(locations[0].uri.fsPath, /User\.php$/);
  });

  test('completion after $this-> / $var-> includes class members', async () => {
    const doc = await openDoc('src/Usage.php');
    const text = doc.getText();
    const idx = text.indexOf('$user->greet');
    const position = doc.positionAt(idx + '$user->'.length);
    const list = (await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      doc.uri,
      position
    )) as vscode.CompletionList;
    const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
    assert.ok(labels.includes('greet'), `expected "greet" among completions, got: ${labels.join(', ')}`);
  });

  test('document symbols expose the class, its method and property', async () => {
    const doc = await openDoc('src/User.php');
    const symbols = (await vscode.commands.executeCommand(
      'vscode.executeDocumentSymbolProvider',
      doc.uri
    )) as vscode.DocumentSymbol[];
    const cls = symbols.find((s) => s.name === 'User');
    assert.ok(cls, 'expected a User class symbol');
    assert.ok(cls!.children.some((c) => c.name.startsWith('greet(')), 'expected a greet() method child symbol');
  });

  test('workspace symbol search finds the User class by name', async () => {
    const results = (await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', 'User')) as vscode.SymbolInformation[];
    assert.ok(results.some((s) => s.name === 'User'), 'expected workspace symbol search to find User');
  });

  test('vendor/ classes are indexed in the background without blocking activation', async () => {
    // The background vendor scan runs concurrently with everything else and yields
    // between batches, so poll for a bit rather than assuming it's done already.
    let results: vscode.SymbolInformation[] = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      results = (await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', 'VendorThing')) as vscode.SymbolInformation[];
      if (results.some((s) => s.name === 'VendorThing')) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(results.some((s) => s.name === 'VendorThing'), 'expected the background vendor/ scan to eventually index VendorThing');
  });

  test('Live Template completion offers the "fore" foreach template', async () => {
    const doc = await openDoc('src/Usage.php');
    const position = new vscode.Position(0, 0);
    const list = (await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      doc.uri,
      position
    )) as vscode.CompletionList;
    const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
    assert.ok(labels.includes('fore'), `expected "fore" live template among completions, got: ${labels.join(', ')}`);
  });

  test('Yii2 module detects the fixture project and navigates view -> controller', async () => {
    const doc = await openDoc('views/site/index.php');
    void doc;
    await vscode.commands.executeCommand('phpstormpp.yii2.goToController');
    await new Promise((r) => setTimeout(r, 500));
    const active = vscode.window.activeTextEditor;
    assert.ok(active, 'expected an active editor after navigation');
    assert.match(active!.document.uri.fsPath, /SiteController\.php$/);
  });

  test('Generate PHPDoc inserts a docblock above a method', async () => {
    const doc = await openDoc('src/User.php');
    const editor = await vscode.window.showTextDocument(doc);
    const text = doc.getText();
    const methodPos = doc.positionAt(text.indexOf('public function greet'));
    editor.selection = new vscode.Selection(methodPos, methodPos);
    await vscode.commands.executeCommand('phpstormpp.generatePhpDoc');
    await new Promise((r) => setTimeout(r, 300));
    const newText = editor.document.getText();
    assert.match(newText, /@param int \$times/);
    // Undo so re-running the suite stays idempotent.
    await vscode.commands.executeCommand('undo');
  });

  test('completion auto-imports a class from another namespace', async () => {
    const doc = await openDoc('src/NeedsImport.php');
    const text = doc.getText();
    const position = doc.positionAt(text.indexOf('new Greeter') + 'new Greeter'.length);
    const list = (await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      doc.uri,
      position
    )) as vscode.CompletionList;
    const item = list.items.find((i) => (typeof i.label === 'string' ? i.label : i.label.label) === 'Greeter');
    assert.ok(item, 'expected a Greeter completion item');
    assert.ok(item!.additionalTextEdits?.length, 'expected an additional text edit adding the use statement');
    assert.match(item!.additionalTextEdits![0].newText, /use App\\Models\\Greeter;/);
  });

  test('unused imports are flagged and removable via quick fix', async () => {
    const doc = await openDoc('src/UnusedImport.php');
    await new Promise((r) => setTimeout(r, 800));

    const diagnostics = vscode.languages.getDiagnostics(doc.uri).filter((d) => d.source === 'phpstormpp');
    assert.strictEqual(diagnostics.length, 1, `expected exactly one unused-import diagnostic, got: ${diagnostics.map((d) => d.message).join(', ')}`);
    assert.match(diagnostics[0].message, /App\\Models\\User/);

    const actions = (await vscode.commands.executeCommand(
      'vscode.executeCodeActionProvider',
      doc.uri,
      diagnostics[0].range
    )) as vscode.CodeAction[];
    const removeAction = actions.find((a) => a.title.includes("Remove unused import 'User'"));
    assert.ok(removeAction, `expected a "Remove unused import" quick fix, got: ${actions.map((a) => a.title).join(', ')}`);

    await vscode.workspace.applyEdit(removeAction!.edit!);
    const newText = doc.getText();
    assert.doesNotMatch(newText, /use App\\Models\\User;/);
    assert.match(newText, /use App\\Models\\Greeter;/);
    await vscode.commands.executeCommand('undo');
  });

  test('completion includes PHP core built-in functions and classes', async () => {
    const doc = await openDoc('src/Usage.php');
    // A blank line inside the class body, bare-word context (not after -> or ::).
    const position = new vscode.Position(doc.lineCount - 1, 0);
    const list = (await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      doc.uri,
      position
    )) as vscode.CompletionList;
    const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
    assert.ok(labels.includes('array_map'), 'expected PHP core function array_map among completions');
    assert.ok(labels.includes('DateTime'), 'expected PHP core class DateTime among completions');
  });

  test('Search Everywhere command is registered and opens without throwing', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('phpstormpp.searchEverywhere'), 'expected phpstormpp.searchEverywhere to be a registered command');

    await vscode.commands.executeCommand('phpstormpp.searchEverywhere');
    await new Promise((r) => setTimeout(r, 200));
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
  });
});
