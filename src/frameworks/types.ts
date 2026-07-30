import * as vscode from 'vscode';
import { PhpIndex } from '../core/phpIndex';

/**
 * Contract for a pluggable framework-support module (PhpStorm has one of these
 * built in per framework — Laravel, Symfony, Drupal, ...). Anyone can add a new
 * one by implementing this interface and registering it in frameworkRegistry.ts;
 * nothing else in the extension needs to change.
 */
export interface FrameworkModule {
  id: string;
  displayName: string;
  /** Cheap workspace-root check (e.g. composer.json dependency) — should not need the full index. */
  detect(workspaceRoot: vscode.Uri): Promise<boolean>;
  activate(context: vscode.ExtensionContext, index: PhpIndex): vscode.Disposable[];
}
