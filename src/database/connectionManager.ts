import * as vscode from 'vscode';
import { DbConnectionConfig, DbDriver } from './types';
import { MysqlDriver } from './drivers/mysqlDriver';
import { PostgresDriver } from './drivers/postgresDriver';

const STORAGE_KEY = 'phpstormpp.database.connections';

function secretKey(id: string): string {
  return `phpstormpp.database.password.${id}`;
}

export class ConnectionManager implements vscode.Disposable {
  private activeDrivers = new Map<string, DbDriver>();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private context: vscode.ExtensionContext) {}

  listConnections(): DbConnectionConfig[] {
    return this.context.globalState.get<DbConnectionConfig[]>(STORAGE_KEY, []);
  }

  async addConnection(config: DbConnectionConfig, password: string): Promise<void> {
    const list = this.listConnections();
    list.push(config);
    await this.context.globalState.update(STORAGE_KEY, list);
    await this.context.secrets.store(secretKey(config.id), password);
    this._onDidChange.fire();
  }

  async removeConnection(id: string): Promise<void> {
    const list = this.listConnections().filter((c) => c.id !== id);
    await this.context.globalState.update(STORAGE_KEY, list);
    await this.context.secrets.delete(secretKey(id));
    await this.activeDrivers.get(id)?.close();
    this.activeDrivers.delete(id);
    this._onDidChange.fire();
  }

  async getDriver(config: DbConnectionConfig): Promise<DbDriver> {
    const existing = this.activeDrivers.get(config.id);
    if (existing) return existing;
    const password = (await this.context.secrets.get(secretKey(config.id))) ?? '';
    const driver = config.driver === 'mysql' ? new MysqlDriver() : new PostgresDriver();
    await driver.connect(config, password);
    this.activeDrivers.set(config.id, driver);
    return driver;
  }

  dispose(): void {
    for (const d of this.activeDrivers.values()) void d.close();
    this._onDidChange.dispose();
  }
}

export async function promptNewConnection(): Promise<{ config: DbConnectionConfig; password: string } | undefined> {
  const driver = await vscode.window.showQuickPick(['mysql', 'postgres'], { title: 'Database type' });
  if (!driver) return;
  const name = await vscode.window.showInputBox({ title: 'Connection name', value: driver === 'mysql' ? 'MySQL' : 'PostgreSQL' });
  if (!name) return;
  const host = await vscode.window.showInputBox({ title: 'Host', value: '127.0.0.1' });
  if (!host) return;
  const portStr = await vscode.window.showInputBox({ title: 'Port', value: driver === 'mysql' ? '3306' : '5432' });
  if (!portStr) return;
  const user = await vscode.window.showInputBox({ title: 'User', value: driver === 'mysql' ? 'root' : 'postgres' });
  if (!user) return;
  const password = (await vscode.window.showInputBox({ title: 'Password', password: true })) ?? '';
  const database = await vscode.window.showInputBox({ title: 'Database (optional)' });

  return {
    config: {
      id: `${driver}-${Date.now()}`,
      name,
      driver: driver as 'mysql' | 'postgres',
      host,
      port: parseInt(portStr, 10),
      user,
      database: database || undefined
    },
    password
  };
}
