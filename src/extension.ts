import * as vscode from 'vscode';
import { PhpIndex } from './core/phpIndex';
import { PhpHoverProvider } from './language/hoverProvider';
import { PhpDefinitionProvider } from './language/definitionProvider';
import { PhpReferenceProvider } from './language/referenceProvider';
import { PhpDocumentSymbolProvider, PhpWorkspaceSymbolProvider } from './language/documentSymbolProvider';
import { PhpCompletionProvider } from './language/completionProvider';
import { PhpRenameProvider } from './refactor/renameProvider';
import { extractVariable } from './refactor/extractVariable';
import { extractMethod } from './refactor/extractMethod';
import { generateConstructor, generateGettersSetters } from './refactor/generateMembers';
import { generatePhpDoc } from './refactor/phpDocGenerator';
import { LiveTemplateCompletionProvider } from './templates/templateCompletionProvider';
import { ConnectionManager, promptNewConnection } from './database/connectionManager';
import { DatabaseTreeProvider } from './database/treeDataProvider';
import { openQueryPanel } from './database/queryPanel';
import { activateFrameworkModules } from './frameworks/frameworkRegistry';
import { createImportDiagnostics } from './language/importDiagnostics';
import { ImportCodeActionProvider } from './refactor/importCodeActions';
import { optimizeImports } from './refactor/importManager';
import { registerSearchEverywhere } from './language/searchEverywhere';
import { detectFrameworks } from './frameworks/genericDetector';

const PHP_SELECTOR: vscode.DocumentSelector = { language: 'php', scheme: 'file' };

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const index = new PhpIndex();
  context.subscriptions.push(index);

  const { scanned } = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'PHPStorm++: indexing project PHP files' },
    (progress) => index.indexWorkspace(progress)
  );

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  const detected = workspaceRoot ? await detectFrameworks(workspaceRoot) : [];
  const detectedLabel = detected.length ? ` — detected ${detected.map((d) => d.name).join(', ')}` : '';
  vscode.window.setStatusBarMessage(`PHPStorm++: indexed ${scanned} project files${detectedLabel}. Scanning vendor/ in the background...`, 6000);

  // vendor/ (framework + dependency source) can be huge, so it's scanned in the
  // background in small yielding batches instead of blocking activation — see
  // PhpIndex.indexVendorInBackground. Autocomplete for deep vendor classes fills
  // in progressively rather than being capped or gated behind a wait.
  void index.indexVendorInBackground((vendorScanned) => {
    if (vendorScanned > 0) {
      vscode.window.setStatusBarMessage(`PHPStorm++: finished indexing ${vendorScanned} vendor/ files (${index.allClasses().length} classes total).`, 6000);
    }
  });

  const importDiagnostics = createImportDiagnostics(index);
  context.subscriptions.push(importDiagnostics.collection);

  function indexAndRefresh(doc: vscode.TextDocument): void {
    index.indexDocument(doc);
    importDiagnostics.refresh(doc);
  }

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(indexAndRefresh),
    vscode.workspace.onDidOpenTextDocument(indexAndRefresh),
    vscode.workspace.onDidChangeTextDocument((e) => indexAndRefresh(e.document))
  );
  for (const doc of vscode.workspace.textDocuments) indexAndRefresh(doc);

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.php');
  watcher.onDidDelete((uri) => index.removeFile(uri));
  watcher.onDidCreate(async (uri) => indexAndRefresh(await vscode.workspace.openTextDocument(uri)));
  context.subscriptions.push(watcher);

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(PHP_SELECTOR, new PhpHoverProvider(index)),
    vscode.languages.registerDefinitionProvider(PHP_SELECTOR, new PhpDefinitionProvider(index)),
    vscode.languages.registerReferenceProvider(PHP_SELECTOR, new PhpReferenceProvider(index)),
    vscode.languages.registerDocumentSymbolProvider(PHP_SELECTOR, new PhpDocumentSymbolProvider(index)),
    vscode.languages.registerWorkspaceSymbolProvider(new PhpWorkspaceSymbolProvider(index)),
    vscode.languages.registerRenameProvider(PHP_SELECTOR, new PhpRenameProvider(index)),
    vscode.languages.registerCompletionItemProvider(PHP_SELECTOR, new PhpCompletionProvider(index), '>', ':', '$'),
    vscode.languages.registerCompletionItemProvider(PHP_SELECTOR, new LiveTemplateCompletionProvider()),
    vscode.languages.registerCodeActionsProvider(PHP_SELECTOR, new ImportCodeActionProvider(index), {
      providedCodeActionKinds: ImportCodeActionProvider.providedCodeActionKinds
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('phpstormpp.extractVariable', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) void extractVariable(editor);
    }),
    vscode.commands.registerCommand('phpstormpp.extractMethod', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) void extractMethod(editor, index);
    }),
    vscode.commands.registerCommand('phpstormpp.generateConstructor', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) void generateConstructor(editor, index);
    }),
    vscode.commands.registerCommand('phpstormpp.generateGettersSetters', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) void generateGettersSetters(editor, index);
    }),
    vscode.commands.registerCommand('phpstormpp.generatePhpDoc', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) void generatePhpDoc(editor, index);
    }),
    vscode.commands.registerCommand('phpstormpp.generate', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const pick = await vscode.window.showQuickPick(
        [
          { label: 'Constructor', action: () => generateConstructor(editor, index) },
          { label: 'Getters and Setters', action: () => generateGettersSetters(editor, index) },
          { label: 'PHPDoc', action: () => generatePhpDoc(editor, index) }
        ],
        { title: 'Generate' }
      );
      await pick?.action();
    }),
    vscode.commands.registerCommand('phpstormpp.reindex', () =>
      vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'PHPStorm++: rebuilding index' }, (progress) =>
        index.indexWorkspace(progress)
      )
    ),
    vscode.commands.registerCommand('phpstormpp.optimizeImports', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      await optimizeImports(editor, index);
      importDiagnostics.refresh(editor.document);
    })
  );

  const connections = new ConnectionManager(context);
  context.subscriptions.push(connections);
  const dbTree = new DatabaseTreeProvider(connections);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('phpstormpp.database', dbTree));

  context.subscriptions.push(
    vscode.commands.registerCommand('phpstormpp.database.addConnection', async () => {
      const result = await promptNewConnection();
      if (!result) return;
      await connections.addConnection(result.config, result.password);
      dbTree.refresh();
    }),
    vscode.commands.registerCommand('phpstormpp.database.newQuery', async (node?: { data?: { config?: any } }) => {
      const configs = connections.listConnections();
      if (!configs.length) {
        vscode.window.showWarningMessage('PHPStorm++: add a database connection first.');
        return;
      }
      const config =
        node?.data?.config ??
        (await vscode.window.showQuickPick(
          configs.map((c) => ({ label: c.name, config: c })),
          { title: 'Choose connection' }
        ).then((r) => r?.config));
      if (!config) return;
      openQueryPanel(connections, config);
    }),
    vscode.commands.registerCommand('phpstormpp.database.runQuery', async (node?: { data?: { config?: any } }) => {
      if (node?.data?.config) openQueryPanel(connections, node.data.config);
    })
  );

  const frameworkDisposables = await activateFrameworkModules(context, index);
  context.subscriptions.push(...frameworkDisposables);

  context.subscriptions.push(registerSearchEverywhere(index));
}

export function deactivate(): void {
  // All resources are registered via context.subscriptions and disposed by VS Code.
}
