import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { DbConnectionConfig } from './types';

type NodeData =
  | { kind: 'connection'; config: DbConnectionConfig }
  | { kind: 'table'; config: DbConnectionConfig; table: string }
  | { kind: 'column'; label: string };

class DbTreeItem extends vscode.TreeItem {
  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState, public data: NodeData) {
    super(label, collapsibleState);
    if (data.kind === 'connection') {
      this.contextValue = 'connection';
      this.iconPath = new vscode.ThemeIcon('database');
    } else if (data.kind === 'table') {
      this.contextValue = 'table';
      this.iconPath = new vscode.ThemeIcon('table');
    } else {
      this.iconPath = new vscode.ThemeIcon('symbol-field');
    }
  }
}

export class DatabaseTreeProvider implements vscode.TreeDataProvider<DbTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private connections: ConnectionManager) {
    connections.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DbTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DbTreeItem): Promise<DbTreeItem[]> {
    if (!element) {
      return this.connections
        .listConnections()
        .map((config) => new DbTreeItem(config.name, vscode.TreeItemCollapsibleState.Collapsed, { kind: 'connection', config }));
    }

    if (element.data.kind === 'connection') {
      const config = element.data.config;
      try {
        const driver = await this.connections.getDriver(config);
        const tables = await driver.listTables(config.database);
        return tables.map((table) => new DbTreeItem(table, vscode.TreeItemCollapsibleState.Collapsed, { kind: 'table', config, table }));
      } catch (e: any) {
        vscode.window.showErrorMessage(`PHPStorm++: failed to connect: ${e.message}`);
        return [];
      }
    }

    if (element.data.kind === 'table') {
      const driver = await this.connections.getDriver(element.data.config);
      const columns = await driver.listColumns(element.data.table, element.data.config.database);
      return columns.map(
        (c) => new DbTreeItem(`${c.name}: ${c.type}${c.nullable ? '?' : ''}`, vscode.TreeItemCollapsibleState.None, { kind: 'column', label: c.name })
      );
    }

    return [];
  }
}
