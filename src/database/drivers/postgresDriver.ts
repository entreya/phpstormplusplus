import { Client } from 'pg';
import { ColumnInfo, DbConnectionConfig, DbDriver, QueryResult } from '../types';

export class PostgresDriver implements DbDriver {
  private client?: Client;

  async connect(config: DbConnectionConfig, password: string): Promise<void> {
    this.client = new Client({
      host: config.host,
      port: config.port,
      user: config.user,
      password,
      database: config.database
    });
    await this.client.connect();
  }

  async listSchemas(): Promise<string[]> {
    const res = await this.client!.query(
      `select schema_name from information_schema.schemata where schema_name not like 'pg_%' and schema_name != 'information_schema' order by 1`
    );
    return res.rows.map((r) => r.schema_name);
  }

  async listTables(schema = 'public'): Promise<string[]> {
    const res = await this.client!.query(`select table_name from information_schema.tables where table_schema = $1 order by 1`, [schema]);
    return res.rows.map((r) => r.table_name);
  }

  async listColumns(table: string, schema = 'public'): Promise<ColumnInfo[]> {
    const res = await this.client!.query(
      `select column_name, data_type, is_nullable from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position`,
      [schema, table]
    );
    return res.rows.map((r) => ({ name: r.column_name, type: r.data_type, nullable: r.is_nullable === 'YES' }));
  }

  async query(sql: string): Promise<QueryResult> {
    const res = await this.client!.query(sql);
    const columns = res.fields?.map((f) => f.name) ?? [];
    return {
      columns,
      rows: res.rows.map((r) => columns.map((c) => r[c])),
      rowCount: res.rowCount ?? res.rows.length
    };
  }

  async close(): Promise<void> {
    await this.client?.end();
  }
}
