import {
  LoggingDebugSession,
  InitializedEvent,
  StoppedEvent,
  TerminatedEvent,
  OutputEvent,
  Thread,
  StackFrame,
  Scope,
  Source,
  Handles
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as path from 'node:path';
import { DbgpConnection, DbgpServer, asArray, decodeBase64Text } from './dbgp';

interface LaunchArgs extends DebugProtocol.LaunchRequestArguments {
  port?: number;
  pathMappings?: Record<string, string>;
  stopOnEntry?: boolean;
}

interface PendingBreakpoint {
  line: number;
  path: string;
  condition?: string;
}

/**
 * A Debug Adapter Protocol implementation that speaks Xdebug's DBGp protocol
 * directly over TCP (no dependency on any existing php-debug extension). Covers
 * the core PhpStorm debugging workflow: breakpoints, step in/over/out, call
 * stack, scopes/variables, and watch/eval expressions.
 */
export class XdebugDebugSession extends LoggingDebugSession {
  private server?: DbgpServer;
  private conn?: DbgpConnection;
  private breakpointsByFile = new Map<string, PendingBreakpoint[]>();
  private dbgpBreakpointIds = new Map<string, number[]>();
  private variableHandles = new Handles<{ contextId: number } | { propertyName: string }>();
  private pathMappings: Record<string, string> = {};
  private stopOnEntry = false;
  private currentStackFileByFrame = new Map<number, string>();

  constructor() {
    super();
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(false);
  }

  protected initializeRequest(response: DebugProtocol.InitializeResponse): void {
    response.body = response.body ?? {};
    response.body.supportsConfigurationDoneRequest = true;
    response.body.supportsEvaluateForHovers = true;
    response.body.supportsConditionalBreakpoints = true;
    response.body.supportsSetVariable = false;
    this.sendResponse(response);
  }

  protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchArgs): Promise<void> {
    const port = args.port ?? 9003;
    this.pathMappings = args.pathMappings ?? {};
    this.stopOnEntry = !!args.stopOnEntry;

    this.server = new DbgpServer(port);
    this.server.onConnection = (conn) => this.handleConnection(conn);
    try {
      await this.server.listen();
      this.sendEvent(new OutputEvent(`Listening for Xdebug on port ${port}\n`, 'console'));
    } catch (e: any) {
      this.sendErrorResponse(response, 1001, `Could not listen on port ${port}: ${e.message}`);
      return;
    }
    this.sendResponse(response);
  }

  private async handleConnection(conn: DbgpConnection): Promise<void> {
    this.conn = conn;
    conn.onClose = () => this.sendEvent(new TerminatedEvent());
    await conn.initPromise;

    await conn.send('feature_set', { n: 'max_depth', v: 5 });
    await conn.send('feature_set', { n: 'show_hidden', v: 1 });

    for (const [file, bps] of this.breakpointsByFile) {
      await this.installBreakpoints(file, bps);
    }

    this.sendEvent(new InitializedEvent());

    if (this.stopOnEntry) {
      this.sendEvent(new StoppedEvent('entry', 1));
    } else {
      this.continueExecution('run');
    }
  }

  private localToRemote(localPath: string): string {
    for (const [local, remote] of Object.entries(this.pathMappings)) {
      if (localPath.startsWith(local)) return remote + localPath.slice(local.length);
    }
    return localPath;
  }

  private remoteToLocal(uri: string): string {
    const remotePath = uri.startsWith('file://') ? decodeURIComponent(uri.replace(/^file:\/\//, '')) : uri;
    for (const [local, remote] of Object.entries(this.pathMappings)) {
      if (remotePath.startsWith(remote)) return local + remotePath.slice(remote.length);
    }
    return remotePath;
  }

  private toFileUri(localPath: string): string {
    const remote = this.localToRemote(localPath);
    const normalized = remote.split(path.sep).join('/');
    return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
  }

  private async installBreakpoints(file: string, bps: PendingBreakpoint[]): Promise<void> {
    if (!this.conn) return;
    const existing = this.dbgpBreakpointIds.get(file) ?? [];
    for (const id of existing) {
      await this.conn.send('breakpoint_remove', { d: id });
    }
    const newIds: number[] = [];
    for (const bp of bps) {
      const res = await this.conn.send('breakpoint_set', {
        t: 'line',
        f: this.toFileUri(file),
        n: bp.line,
        ...(bp.condition ? {} : {})
      });
      const id = Number(res['@_id']);
      if (!Number.isNaN(id)) newIds.push(id);
    }
    this.dbgpBreakpointIds.set(file, newIds);
  }

  protected async setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ): Promise<void> {
    const file = args.source.path ?? '';
    const bps: PendingBreakpoint[] = (args.breakpoints ?? []).map((b) => ({ line: b.line, path: file, condition: b.condition }));
    this.breakpointsByFile.set(file, bps);

    if (this.conn) {
      await this.installBreakpoints(file, bps);
    }

    response.body = { breakpoints: bps.map((b) => ({ verified: true, line: b.line })) };
    this.sendResponse(response);
  }

  protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse): void {
    this.sendResponse(response);
  }

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    response.body = { threads: [new Thread(1, 'Main Thread')] };
    this.sendResponse(response);
  }

  private async continueExecution(command: 'run' | 'step_into' | 'step_over' | 'step_out'): Promise<void> {
    if (!this.conn) return;
    const res = await this.conn.send(command);
    const status = res['@_status'];
    if (status === 'stopping' || status === 'stopped') {
      await this.conn.send('stop');
      this.sendEvent(new TerminatedEvent());
      return;
    }
    if (status === 'break') {
      this.sendEvent(new StoppedEvent(command === 'run' ? 'breakpoint' : 'step', 1));
    }
  }

  protected continueRequest(response: DebugProtocol.ContinueResponse): void {
    this.sendResponse(response);
    this.continueExecution('run');
  }

  protected nextRequest(response: DebugProtocol.NextResponse): void {
    this.sendResponse(response);
    this.continueExecution('step_over');
  }

  protected stepInRequest(response: DebugProtocol.StepInResponse): void {
    this.sendResponse(response);
    this.continueExecution('step_into');
  }

  protected stepOutRequest(response: DebugProtocol.StepOutResponse): void {
    this.sendResponse(response);
    this.continueExecution('step_out');
  }

  protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse): Promise<void> {
    if (!this.conn) {
      response.body = { stackFrames: [], totalFrames: 0 };
      this.sendResponse(response);
      return;
    }
    const res = await this.conn.send('stack_get');
    const frames = asArray(res.stack).map((f: any, i: number) => {
      const localPath = this.remoteToLocal(f['@_filename']);
      this.currentStackFileByFrame.set(i, localPath);
      return new StackFrame(i, f['@_where'] ?? '?', new Source(path.basename(localPath), localPath), Number(f['@_lineno']));
    });
    response.body = { stackFrames: frames, totalFrames: frames.length };
    this.sendResponse(response);
  }

  protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
    const localHandle = this.variableHandles.create({ contextId: 0 });
    const superGlobalsHandle = this.variableHandles.create({ contextId: 1 });
    response.body = {
      scopes: [new Scope('Local', localHandle, false), new Scope('Superglobals', superGlobalsHandle, true)]
    };
    void args;
    this.sendResponse(response);
  }

  protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
    const handle = this.variableHandles.get(args.variablesReference);
    if (!this.conn || !handle) {
      response.body = { variables: [] };
      this.sendResponse(response);
      return;
    }

    let properties: any[];
    if ('contextId' in handle) {
      const res = await this.conn.send('context_get', { c: handle.contextId, d: 0 });
      properties = asArray(res.property);
    } else {
      const res = await this.conn.send('property_get', { n: handle.propertyName, d: 0 });
      properties = asArray(res.property?.property ?? res.property);
    }

    response.body = {
      variables: properties.map((p) => this.toVariable(p))
    };
    this.sendResponse(response);
  }

  private toVariable(p: any): DebugProtocol.Variable {
    const name = p['@_name'] ?? '(unknown)';
    const type = p['@_type'] ?? 'mixed';
    const hasChildren = p['@_children'] === '1' || Number(p['@_numchildren'] ?? 0) > 0;
    const fullName = p['@_fullname'] ?? name;
    const value = hasChildren ? `${type}` : decodeBase64Text(p) ?? '';
    return {
      name,
      value,
      type,
      variablesReference: hasChildren ? this.variableHandles.create({ propertyName: fullName }) : 0
    };
  }

  protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {
    if (!this.conn) {
      response.body = { result: '', variablesReference: 0 };
      this.sendResponse(response);
      return;
    }
    const res = await this.conn.send('eval', {}, args.expression);
    const prop = res.property;
    const text = decodeBase64Text(prop) ?? '';
    const hasChildren = prop?.['@_children'] === '1';
    response.body = {
      result: text,
      variablesReference: hasChildren ? this.variableHandles.create({ propertyName: prop['@_fullname'] ?? args.expression }) : 0
    };
    this.sendResponse(response);
  }

  protected async disconnectRequest(response: DebugProtocol.DisconnectResponse): Promise<void> {
    try {
      await this.conn?.send('stop');
    } catch {
      // engine may already be gone
    }
    this.conn?.close();
    this.server?.close();
    this.sendResponse(response);
  }
}
