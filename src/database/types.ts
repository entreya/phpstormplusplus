export type DbDriverKind = 'mysql' | 'postgres';

export interface DbConnectionConfig {
  id: string;
  name: string;
  driver: DbDriverKind;
  host: string;
  port: number;
  user: string;
  database?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  key?: string;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
}

export interface DbDriver {
  connect(config: DbConnectionConfig, password: string): Promise<void>;
  listSchemas(): Promise<string[]>;
  listTables(schema?: string): Promise<string[]>;
  listColumns(table: string, schema?: string): Promise<ColumnInfo[]>;
  query(sql: string): Promise<QueryResult>;
  close(): Promise<void>;
}
