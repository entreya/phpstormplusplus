import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { searchFileContents, looksLikeTextFile } from '../../src/language/searchEverywhere';
import { tokenizePhp } from '../../src/language/previewPanel';
import { PhpIndex } from '../../src/core/phpIndex';
import { listDirectory } from '../../src/fileExplorerViewProvider';
import * as os from 'os';

// Compiled from test/tsconfig.json with rootDir ".." (so src/ can be imported
// directly for unit tests), so this file lands at out-test/test/suite/... —
// one level deeper than before — hence the extra "..".
const fixtures = path.resolve(__dirname, '../../../test-fixtures');

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

  test('"vecho" Live Template snippet body has correctly escaped $ signs', async () => {
    const doc = await openDoc('src/Usage.php');
    const position = new vscode.Position(0, 0);
    const list = (await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      doc.uri,
      position
    )) as vscode.CompletionList;
    const item = list.items.find((i) => (typeof i.label === 'string' ? i.label : i.label.label) === 'vecho');
    assert.ok(item, 'expected a "vecho" live template completion item');
    const snippet = item!.insertText as vscode.SnippetString;
    assert.strictEqual(snippet.value, "echo '<pre>';\nvar_dump(\\$${1:var});\ndie;");
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

  test('go to definition on an ambiguous class name deterministically resolves the same candidate every time', async () => {
    const doc = await openDoc('src/AmbiguousNotifierUsage.php');
    const text = doc.getText();
    const position = doc.positionAt(text.indexOf('new Notifier') + 'new Notifier'.length);

    for (let attempt = 0; attempt < 3; attempt++) {
      const locations = (await vscode.commands.executeCommand(
        'vscode.executeDefinitionProvider',
        doc.uri,
        position
      )) as vscode.Location[];
      assert.strictEqual(locations.length, 1, `expected exactly one definition location on attempt ${attempt}`);
      assert.match(
        locations[0].uri.fsPath,
        /[\\/]src[\\/]Notifier\.php$/,
        `expected the ambiguous "Notifier" reference to always resolve to src/Notifier.php (App\\Models\\Notifier, alphabetically first), got: ${locations[0].uri.fsPath}`
      );
    }
  });

  test('pasting code that references an unambiguous class auto-adds the use statement', async () => {
    const doc = await openDoc('src/PasteTarget.php');
    const editor = await vscode.window.showTextDocument(doc);
    const text = editor.document.getText();
    const braceIndex = text.indexOf('{', text.indexOf('run(): void'));
    const position = editor.document.positionAt(braceIndex + 2); // start of the blank line inside the method body
    editor.selection = new vscode.Selection(position, position);

    const originalClipboard = await vscode.env.clipboard.readText();
    try {
      await vscode.env.clipboard.writeText('$g = new Greeter();');
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
      await new Promise((r) => setTimeout(r, 300));

      const newText = editor.document.getText();
      assert.match(newText, /use App\\Models\\Greeter;/, `expected a paste-triggered auto-import, got:\n${newText}`);
      assert.match(newText, /\$g = new Greeter\(\);/, 'expected the pasted text itself to still be inserted');
    } finally {
      await vscode.commands.executeCommand('undo');
      await vscode.env.clipboard.writeText(originalClipboard);
    }
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
    assert.ok(
      commands.includes('phpstormpp.preview.focus'),
      'expected the preview webview view to be registered (auto-generated .focus command)'
    );

    const tabsBefore = vscode.window.tabGroups.all.flatMap((g) => g.tabs).length;
    await vscode.commands.executeCommand('phpstormpp.searchEverywhere');
    await new Promise((r) => setTimeout(r, 200));
    const tabsAfterOpen = vscode.window.tabGroups.all.flatMap((g) => g.tabs).length;
    assert.strictEqual(tabsAfterOpen, tabsBefore, 'opening Search Everywhere should not create any editor tabs by itself');

    await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
  });

  test('New PHP Class fills in the PSR-4-resolved namespace and declaration', async () => {
    const targetDir = vscode.Uri.file(path.join(fixtures, 'src'));
    const createdUri = vscode.Uri.file(path.join(fixtures, 'src', 'OrderService.php'));

    const originalQuickPick = vscode.window.showQuickPick;
    const originalInputBox = vscode.window.showInputBox;
    (vscode.window as any).showQuickPick = async () => 'Class';
    (vscode.window as any).showInputBox = async () => 'OrderService';
    try {
      await vscode.commands.executeCommand('phpstormpp.newPhpClass', targetDir);
    } finally {
      (vscode.window as any).showQuickPick = originalQuickPick;
      (vscode.window as any).showInputBox = originalInputBox;
    }

    await new Promise((r) => setTimeout(r, 200));
    const bytes = await vscode.workspace.fs.readFile(createdUri);
    const text = Buffer.from(bytes).toString('utf8');
    assert.match(text, /namespace App;/, `expected "namespace App;" in generated file, got:\n${text}`);
    assert.match(text, /class OrderService/, `expected "class OrderService" in generated file, got:\n${text}`);

    await vscode.workspace.fs.delete(createdUri);
  });

  test('creating an empty PascalCase .php file auto-fills namespace and class declaration', async () => {
    const createdUri = vscode.Uri.file(path.join(fixtures, 'src', 'InvoiceService.php'));

    const edit = new vscode.WorkspaceEdit();
    edit.createFile(createdUri);
    await vscode.workspace.applyEdit(edit);
    await new Promise((r) => setTimeout(r, 300));

    const bytes = await vscode.workspace.fs.readFile(createdUri);
    const text = Buffer.from(bytes).toString('utf8');
    assert.match(text, /namespace App;/, `expected auto-filled namespace, got:\n${text}`);
    assert.match(text, /class InvoiceService/, `expected auto-filled class declaration, got:\n${text}`);

    await vscode.workspace.fs.delete(createdUri);
  });

  test('content search finds a string literal that no file/class/method name matches', async () => {
    const targetUri = vscode.Uri.file(path.join(fixtures, 'src', 'RelativeGradingFunctionRouter.php'));
    assert.ok(looksLikeTextFile(targetUri), 'expected a .php file to be recognized as text-searchable');

    const candidateFiles = await vscode.workspace.findFiles('**/*.php', '**/vendor/**');
    const matches = await searchFileContents('Response not success from the RelativeGradingFunctionRouter', candidateFiles);

    const hit = matches.find((m) => m.uri?.fsPath === targetUri.fsPath);
    assert.ok(hit, `expected a content match in RelativeGradingFunctionRouter.php, got matches in: ${matches.map((m) => m.description).join(', ')}`);
    assert.strictEqual(hit!.range?.start.line, 8, 'expected the match to be on the line containing the string literal');
  });

  test('preview panel PHP tokenizer classifies keywords, strings, variables, and comments', () => {
    const tokens = tokenizePhp("// a comment\nclass Foo { public function bar() { return 'hi ' . $baz; } }");
    const byText2 = (text: string) => tokens.find((t) => t.text === text);
    assert.strictEqual(byText2("'hi '")?.cls, 'str', 'expected the string literal to be classified as a string');
    const byText = (text: string) => tokens.find((t) => t.text === text);

    assert.strictEqual(byText('// a comment')?.cls, 'cm', 'expected the line comment to be classified as a comment');
    assert.strictEqual(byText('class')?.cls, 'kw', 'expected "class" to be classified as a keyword');
    assert.strictEqual(byText('public')?.cls, 'kw', 'expected "public" to be classified as a keyword');
    assert.strictEqual(byText('$baz')?.cls, 'var', 'expected "$baz" to be classified as a variable');
    assert.strictEqual(byText('Foo')?.cls, undefined, 'expected the class name itself to be left unclassified (not a keyword)');
  });

  test('Check for Updates command is registered and never throws (network optional)', async function () {
    this.timeout(15000);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('phpstormpp.checkForUpdates'), 'expected phpstormpp.checkForUpdates to be a registered command');

    // If a newer release genuinely exists, the real command awaits a user choice
    // via showInformationMessage — mock it so the test can't hang on that in a
    // headless run, regardless of what GitHub currently reports as latest.
    const originalInfo = vscode.window.showInformationMessage;
    const originalWarn = vscode.window.showWarningMessage;
    (vscode.window as any).showInformationMessage = async () => undefined;
    (vscode.window as any).showWarningMessage = async () => undefined;
    try {
      await vscode.commands.executeCommand('phpstormpp.checkForUpdates');
    } finally {
      (vscode.window as any).showInformationMessage = originalInfo;
      (vscode.window as any).showWarningMessage = originalWarn;
    }
  });

  test('Command Center is registered and dispatches a picked item to the right command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('phpstormpp.openCommandCenter'), 'expected phpstormpp.openCommandCenter to be a registered command');

    let executedReindex = false;
    const originalExecute = vscode.commands.executeCommand;
    const originalQuickPick = vscode.window.showQuickPick;
    (vscode.commands as any).executeCommand = async (command: string, ...args: unknown[]) => {
      if (command === 'phpstormpp.reindex') executedReindex = true;
      return originalExecute.apply(vscode.commands, [command, ...args] as Parameters<typeof originalExecute>);
    };
    (vscode.window as any).showQuickPick = async (items: any[]) => items.find((i) => i.label?.includes('Rebuild PHP Index'));
    try {
      await vscode.commands.executeCommand('phpstormpp.openCommandCenter');
      await new Promise((r) => setTimeout(r, 200));
    } finally {
      (vscode.commands as any).executeCommand = originalExecute;
      (vscode.window as any).showQuickPick = originalQuickPick;
    }
    assert.ok(executedReindex, 'expected picking "Rebuild PHP Index" to invoke phpstormpp.reindex');
  });

  test('disk cache round-trips a real index and is actually used on the next load', async () => {
    const cacheDir = vscode.Uri.file(path.join(os.tmpdir(), `phpstormpp-test-cache-${Date.now()}`));

    const index1 = new PhpIndex();
    await index1.loadDiskCache(cacheDir);
    const first = await index1.indexWorkspace();
    assert.strictEqual(first.fromCache, 0, 'expected a fresh cache dir to produce zero cache hits');
    assert.ok(first.scanned > 0, 'expected the scan to find fixture files');
    await index1.flushDiskCache(cacheDir);
    index1.dispose();

    // Same files, same mtimes (nothing touched them) — a second PhpIndex loading
    // the just-saved cache should serve them from disk instead of re-parsing.
    const index2 = new PhpIndex();
    await index2.loadDiskCache(cacheDir);
    const second = await index2.indexWorkspace();
    assert.strictEqual(second.fromCache, first.scanned, 'expected every file to be served from cache on the second load');

    const user = index2.findClassByFqcn('App\\Models\\User');
    assert.ok(user, 'expected the cached index to still resolve the User class');
    assert.ok(user!.range instanceof vscode.Range, 'expected a real vscode.Range to be reconstructed from the cache, not a plain look-alike object');
    assert.doesNotThrow(() => user!.range.contains(user!.nameRange), 'expected the reconstructed Range to have working prototype methods');
    index2.dispose();

    await vscode.workspace.fs.delete(cacheDir, { recursive: true });
  });

  test('file explorer command is registered and listDirectory sorts folders before files', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('phpstormpp.main.focus'), 'expected the file explorer webview view to be registered (auto-generated .focus command)');

    const entries = await listDirectory(vscode.Uri.file(fixtures));
    const names = entries.map((e) => e.name);
    assert.deepStrictEqual(names, ['controllers', 'src', 'vendor', 'views', 'composer.json'], 'expected directories sorted alphabetically before files');
    assert.ok(entries.find((e) => e.name === 'src')?.isDirectory);
    assert.ok(!entries.find((e) => e.name === 'composer.json')?.isDirectory);
  });
});
