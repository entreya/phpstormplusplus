import * as net from 'node:net';
import { XMLParser } from 'fast-xml-parser';

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

export interface DbgpPacket {
  [key: string]: any;
}

/**
 * One accepted TCP connection from an Xdebug engine, speaking the DBGp protocol:
 * https://xdebug.org/docs/dbgp — requests are plain `command -args\0` lines sent by
 * us; responses from the engine are length-prefixed `<len>\0<xml>\0`.
 */
export class DbgpConnection {
  private buffer = Buffer.alloc(0);
  private nextTransactionId = 1;
  private pending = new Map<number, (packet: DbgpPacket) => void>();
  private initResolve?: (packet: DbgpPacket) => void;
  readonly initPromise: Promise<DbgpPacket>;

  onNotify?: (packet: DbgpPacket) => void;
  onClose?: () => void;

  constructor(private socket: net.Socket) {
    this.initPromise = new Promise((resolve) => (this.initResolve = resolve));
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('close', () => this.onClose?.());
    socket.on('error', () => this.onClose?.());
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const nul = this.buffer.indexOf(0);
      if (nul === -1) return;
      const head = this.buffer.subarray(0, nul).toString('ascii');
      if (!/^\d+$/.test(head)) {
        // Not a length prefix we understand; drop it to avoid getting stuck.
        this.buffer = this.buffer.subarray(nul + 1);
        continue;
      }
      const len = parseInt(head, 10);
      const bodyStart = nul + 1;
      if (this.buffer.length < bodyStart + len + 1) return; // wait for more data
      const xml = this.buffer.subarray(bodyStart, bodyStart + len).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + len + 1);
      this.handlePacket(xml);
    }
  }

  private handlePacket(xml: string): void {
    let parsed: DbgpPacket;
    try {
      parsed = xmlParser.parse(xml);
    } catch {
      return;
    }
    const root = parsed.init ?? parsed.response ?? parsed.stream ?? parsed.notify;
    if (parsed.init) {
      this.initResolve?.(parsed.init);
      return;
    }
    if (parsed.response) {
      const txId = Number(parsed.response['@_transaction_id']);
      const resolver = this.pending.get(txId);
      if (resolver) {
        this.pending.delete(txId);
        resolver(parsed.response);
      }
      return;
    }
    if (parsed.notify) {
      this.onNotify?.(parsed.notify);
      return;
    }
    void root;
  }

  send(command: string, args: Record<string, string | number | boolean | undefined> = {}, data?: string): Promise<DbgpPacket> {
    const txId = this.nextTransactionId++;
    let line = `${command} -i ${txId}`;
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined) continue;
      line += ` -${key} ${typeof value === 'string' && value.includes(' ') ? JSON.stringify(value) : value}`;
    }
    if (data !== undefined) {
      line += ` -- ${Buffer.from(data, 'utf8').toString('base64')}`;
    }
    return new Promise((resolve) => {
      this.pending.set(txId, resolve);
      this.socket.write(line + '\0');
    });
  }

  close(): void {
    this.socket.end();
  }
}

export class DbgpServer {
  private server: net.Server;
  onConnection?: (conn: DbgpConnection) => void;

  constructor(private port: number) {
    this.server = net.createServer((socket) => {
      const conn = new DbgpConnection(socket);
      this.onConnection?.(conn);
    });
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, () => resolve());
    });
  }

  close(): void {
    this.server.close();
  }
}

/** Decodes a DBGp `<property>` node's base64-encoded value, when present. */
export function decodeBase64Text(node: DbgpPacket | undefined): string | undefined {
  const text = node?.['#text'];
  if (text === undefined) return undefined;
  try {
    return Buffer.from(String(text), 'base64').toString('utf8');
  } catch {
    return String(text);
  }
}

export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
