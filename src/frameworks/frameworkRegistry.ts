import * as vscode from 'vscode';
import { FrameworkModule } from './types';
import { Yii2Module } from './yii2';
import { PhpIndex } from '../core/phpIndex';

/** All known framework modules. Add new ones here — that's the only edit required. */
const KNOWN_MODULES: FrameworkModule[] = [new Yii2Module()];

export async function activateFrameworkModules(context: vscode.ExtensionContext, index: PhpIndex): Promise<vscode.Disposable[]> {
  const enabled = new Set(vscode.workspace.getConfiguration('phpstormpp').get<string[]>('frameworks.enabled', []));
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return [];

  const disposables: vscode.Disposable[] = [];
  for (const mod of KNOWN_MODULES) {
    if (!enabled.has(mod.id)) continue;
    try {
      if (await mod.detect(root)) {
        disposables.push(...mod.activate(context, index));
        vscode.window.setStatusBarMessage(`PHPStorm++: ${mod.displayName} support active`, 4000);
      }
    } catch {
      // detection failure shouldn't block the rest of the extension
    }
  }
  return disposables;
}
