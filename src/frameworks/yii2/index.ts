import * as vscode from 'vscode';
import { FrameworkModule } from '../types';
import { PhpIndex } from '../../core/phpIndex';

function pascalToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function snakeToPascal(s: string): string {
  return s.split(/[-_]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

/**
 * Minimal Yii2 support: detects a Yii2 project via composer.json, and provides
 * "Go to Controller" / "Go to View" navigation following Yii2's controllerId/actionId
 * conventions (SiteController::actionIndex() <-> views/site/index.php).
 */
export class Yii2Module implements FrameworkModule {
  id = 'yii2';
  displayName = 'Yii2';

  async detect(workspaceRoot: vscode.Uri): Promise<boolean> {
    try {
      const composerUri = vscode.Uri.joinPath(workspaceRoot, 'composer.json');
      const bytes = await vscode.workspace.fs.readFile(composerUri);
      const json = JSON.parse(Buffer.from(bytes).toString('utf8'));
      const deps = { ...json.require, ...json['require-dev'] };
      return Object.keys(deps).some((k) => k.startsWith('yiisoft/yii2'));
    } catch {
      return false;
    }
  }

  activate(_context: vscode.ExtensionContext, index: PhpIndex): vscode.Disposable[] {
    const goToView = vscode.commands.registerCommand('phpstormpp.yii2.goToView', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const file = index.getFile(editor.document.uri);
      const cls = file?.classes.find((c) => c.range.contains(editor.selection.active));
      const method = cls?.methods.find((m) => m.range.contains(editor.selection.active));
      if (!cls || !method || !cls.name.endsWith('Controller') || !method.name.startsWith('action')) {
        vscode.window.showWarningMessage('PHPStorm++/Yii2: place the cursor inside an action*() method of a *Controller class.');
        return;
      }
      const controllerId = pascalToSnake(cls.name.replace(/Controller$/, ''));
      const actionId = pascalToSnake(method.name.replace(/^action/, ''));
      const candidates = await vscode.workspace.findFiles(`**/views/${controllerId}/${actionId}.php`, '**/vendor/**', 5);
      if (!candidates.length) {
        vscode.window.showWarningMessage(`PHPStorm++/Yii2: no view found for ${controllerId}/${actionId}.`);
        return;
      }
      await vscode.window.showTextDocument(candidates[0]);
    });

    const goToController = vscode.commands.registerCommand('phpstormpp.yii2.goToController', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const match = /views[\\/]([^\\/]+)[\\/]([^\\/]+)\.php$/.exec(editor.document.uri.fsPath);
      if (!match) {
        vscode.window.showWarningMessage('PHPStorm++/Yii2: open a file under a views/<controller>/ directory first.');
        return;
      }
      const [, controllerId, actionId] = match;
      const controllerClass = `${snakeToPascal(controllerId)}Controller`;
      const actionMethod = `action${snakeToPascal(actionId)}`;
      const candidates = await vscode.workspace.findFiles(`**/${controllerClass}.php`, '**/vendor/**', 5);
      if (!candidates.length) {
        vscode.window.showWarningMessage(`PHPStorm++/Yii2: controller ${controllerClass} not found.`);
        return;
      }
      const doc = await vscode.workspace.openTextDocument(candidates[0]);
      const editorOpened = await vscode.window.showTextDocument(doc);
      const file = index.getFile(candidates[0]);
      const cls = file?.classes.find((c) => c.name === controllerClass);
      const method = cls?.methods.find((m) => m.name.toLowerCase() === actionMethod.toLowerCase());
      if (method) {
        editorOpened.selection = new vscode.Selection(method.nameRange.start, method.nameRange.start);
        editorOpened.revealRange(method.nameRange);
      }
    });

    return [goToView, goToController];
  }
}
