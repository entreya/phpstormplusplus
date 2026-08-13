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
import { EmptyTreeProvider } from './terminalPanelView';
import { activateFrameworkModules } from './frameworks/frameworkRegistry';
import { createImportDiagnostics } from './language/importDiagnostics';
import { ImportCodeActionProvider } from './refactor/importCodeActions';
import { optimizeImports } from './refactor/importManager';
import { registerSearchEverywhere } from './language/searchEverywhere';
import { detectFrameworks } from './frameworks/genericDetector';
import { newPhpClass, registerAutoClassOnCreate } from './refactor/newPhpClass';
import { PreviewViewProvider } from './language/previewPanel';
import { checkForUpdates } from './updateChecker';
import { registerCommandCenter } from './commandCenter';
import { PasteImportProvider } from './language/pasteImportProvider';

const PHP_SELECTOR: vscode.DocumentSelector = { language: 'php', scheme: 'file' };

// Held so deactivate() can flush any cache entries accumulated after the
// last explicit flush (e.g. from files edited/saved during the session).
let activeIndex: PhpIndex | undefined;
let activeCacheDir: vscode.Uri | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const index = new PhpIndex();
  context.subscriptions.push(index);

  // Per-workspace cache directory for the parsed index — undefined when no
  // workspace folder is open, in which case caching is simply skipped.
  const cacheDir = context.storageUri;
  activeIndex = index;
  activeCacheDir = cacheDir;
  await index.loadDiskCache(cacheDir);

  const currentVersion = context.extension.packageJSON.version as string;
  void checkForUpdates(context, currentVersion, false);
  // checkForUpdates self-throttles to once/24h via globalState, but that
  // throttle only matters if something actually re-invokes it — activation
  // alone only fires once per window reload. A long-running window that's
  // never reloaded would otherwise never check again. This interval is the
  // "wake up and see if it's been a day yet" heartbeat; the throttle inside
  // checkForUpdates still governs how often it actually hits the network.
  const updateCheckTimer = setInterval(() => void checkForUpdates(context, currentVersion, false), 60 * 60 * 1000);
  context.subscriptions.push(
    { dispose: () => clearInterval(updateCheckTimer) },
    vscode.commands.registerCommand('phpstormpp.checkForUpdates', () => checkForUpdates(context, currentVersion, true))
  );

  const { scanned, fromCache: projectFromCache } = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'PHPStorm++: indexing project PHP files' },
    (progress) => index.indexWorkspace(progress)
  );
  await index.flushDiskCache(cacheDir);

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  const detected = workspaceRoot ? await detectFrameworks(workspaceRoot) : [];
  const detectedLabel = detected.length ? ` — detected ${detected.map((d) => d.name).join(', ')}` : '';
  const cacheLabel = projectFromCache > 0 ? ` (${projectFromCache} from cache)` : '';
  vscode.window.setStatusBarMessage(
    `PHPStorm++: indexed ${scanned} project files${cacheLabel}${detectedLabel}. Scanning vendor/ in the background...`,
    6000
  );

  // vendor/ (framework + dependency source) can be huge, so it's scanned in the
  // background in small yielding batches instead of blocking activation — see
  // PhpIndex.indexVendorInBackground. Autocomplete for deep vendor classes fills
  // in progressively rather than being capped or gated behind a wait. Unchanged
  // vendor files load straight from the disk cache instead of being re-parsed —
  // by far the biggest win, since dependencies rarely change between sessions.
  void index.indexVendorInBackground(async (vendorScanned, vendorFromCache) => {
    if (vendorScanned > 0) {
      const vendorCacheLabel = vendorFromCache > 0 ? ` (${vendorFromCache} from cache)` : '';
      vscode.window.setStatusBarMessage(
        `PHPStorm++: finished indexing ${vendorScanned} vendor/ files${vendorCacheLabel} (${index.allClasses().length} classes total).`,
        6000
      );
    }
    await index.flushDiskCache(cacheDir);
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
    }),
    vscode.languages.registerDocumentPasteEditProvider(PHP_SELECTOR, new PasteImportProvider(index), {
      providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.TextUpdateImports.append('php')],
      pasteMimeTypes: ['text/plain']
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

  function openPhpStormTerminal(): void {
    // Reuse the existing "PHPStorm++" terminal if one's already open, like
    // PhpStorm's own Terminal tool window button, rather than piling up a
    // fresh one on every click.
    const existing = vscode.window.terminals.find((t) => t.name === 'PHPStorm++');
    const terminal = existing ?? vscode.window.createTerminal('PHPStorm++');
    terminal.show();
  }

  // The panel has no content of its own — revealing it (clicking the activity
  // bar icon) just opens the terminal directly, no intermediate click-through.
  const mainTreeView = vscode.window.createTreeView('phpstormpp.main', { treeDataProvider: new EmptyTreeProvider() });
  context.subscriptions.push(
    mainTreeView,
    mainTreeView.onDidChangeVisibility((e) => {
      if (e.visible) openPhpStormTerminal();
    }),
    vscode.commands.registerCommand('phpstormpp.openTerminal', openPhpStormTerminal)
  );

  const frameworkDisposables = await activateFrameworkModules(context, index);
  context.subscriptions.push(...frameworkDisposables);

  const previewProvider = new PreviewViewProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PreviewViewProvider.viewId, previewProvider),
    registerSearchEverywhere(index, previewProvider)
  );

  context.subscriptions.push(
    registerAutoClassOnCreate(),
    vscode.commands.registerCommand('phpstormpp.newPhpClass', (uri?: vscode.Uri) => newPhpClass(uri))
  );

  context.subscriptions.push(...registerCommandCenter());
}

export async function deactivate(): Promise<void> {
  // All other resources are registered via context.subscriptions and disposed
  // by VS Code — this is the one thing that needs an explicit final flush, so
  // files indexed live during the session (not just the two bulk scans) are
  // cached for next time too.
  await activeIndex?.flushDiskCache(activeCacheDir);
}
