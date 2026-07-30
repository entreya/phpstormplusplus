import * as mysql from 'mysql2/promise';
import { ColumnInfo, DbConnectionConfig, DbDriver, QueryResult } from '../types';

export class MysqlDriver implements DbDriver {
  private conn?: mysql.Connection;
  private database?: string;

  async connect(config: DbConnectionConfig, password: string): Promise<void> {
    this.database = config.database;
    this.conn = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password,
      database: config.database
    });
  }

  async listSchemas(): Promise<string[]> {
    const [rows] = await this.conn!.query<mysql.RowDataPacket[]>('SHOW DATABASES');
    return rows.map((r) => Object.values(r)[0] as string);
  }

  async listTables(): Promise<string[]> {
    const [rows] = await this.conn!.query<mysql.RowDataPacket[]>('SHOW TABLES');
    return rows.map((r) => Object.values(r)[0] as string);
  }

  async listColumns(table: string): Promise<ColumnInfo[]> {
    const [rows] = await this.conn!.query<mysql.RowDataPacket[]>('SHOW COLUMNS FROM ??', [table]);
    return rows.map((r: any) => ({
      name: r.Field,
      type: r.Type,
      nullable: r.Null === 'YES',
      key: r.Key || undefined
    }));
  }

  async query(sql: string): Promise<QueryResult> {
    const [rows, fields] = await this.conn!.query(sql);
    if (Array.isArray(rows)) {
      const columns = (fields as mysql.FieldPacket[])?.map((f) => f.name) ?? Object.keys((rows[0] as object) ?? {});
      return {
        columns,
        rows: (rows as any[]).map((r) => columns.map((c) => r[c])),
        rowCount: (rows as any[]).length
      };
    }
    return { columns: ['affectedRows'], rows: [[(rows as any).affectedRows]], rowCount: 1 };
  }

  async close(): Promise<void> {
    await this.conn?.end();
  }
}
