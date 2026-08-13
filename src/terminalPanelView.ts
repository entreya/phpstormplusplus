import * as vscode from 'vscode';

/**
 * Always-empty tree so the `viewsWelcome` content (an "Open Terminal" button)
 * is what actually shows in the PHPStorm++ panel — VS Code only renders
 * `viewsWelcome` for a tree view when it has zero items, which is the
 * standard pattern for an action-only, no-list view.
 */
export class EmptyTreeProvider implements vscode.TreeDataProvider<never> {
  getTreeItem(element: never): vscode.TreeItem {
    return element;
  }

  getChildren(): never[] {
    return [];
  }
}
