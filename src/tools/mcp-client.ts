import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 30_000;

/**
 * Encodes a JSON-RPC message with Content-Length framing for MCP stdio transport.
 */
function encodeMessage(msg: unknown): Buffer {
  const body = JSON.stringify(msg);
  const bodyBytes = Buffer.from(body, 'utf-8');
  const header = `Content-Length: ${bodyBytes.byteLength}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, 'ascii'), bodyBytes]);
}

/**
 * Parses Content-Length framed messages from a stream of buffers.
 * Emits 'message' events with parsed JSON objects.
 */
class MessageParser extends EventEmitter {
  private buffer = Buffer.alloc(0);

  feed(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.tryParse();
  }

  private tryParse(): void {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Look for the header/body separator
      const separatorIdx = this.buffer.indexOf('\r\n\r\n');
      if (separatorIdx === -1) return;

      // Parse Content-Length from header section
      const headerSection = this.buffer.subarray(0, separatorIdx).toString('ascii');
      const match = /Content-Length:\s*(\d+)/i.exec(headerSection);
      if (!match) {
        // Malformed header — skip past separator and try again
        this.buffer = this.buffer.subarray(separatorIdx + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = separatorIdx + 4;

      // Wait for full body
      if (this.buffer.byteLength < bodyStart + contentLength) return;

      const bodyBuf = this.buffer.subarray(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.subarray(bodyStart + contentLength);

      try {
        const parsed = JSON.parse(bodyBuf.toString('utf-8'));
        this.emit('message', parsed);
      } catch {
        // Skip unparseable messages
      }
    }
  }
}

export class McpConnection {
  private process: ChildProcess | null = null;
  private parser = new MessageParser();
  private nextId = 1;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  private connected = false;
  private stderr: string[] = [];

  constructor(private config: McpServerConfig) {}

  get name(): string {
    return this.config.name;
  }

  async connect(): Promise<void> {
    const env = { ...process.env, ...(this.config.env ?? {}) };

    this.process = spawn(this.config.command, this.config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    this.process.on('error', (err) => {
      this.rejectAll(new Error(`MCP server "${this.config.name}" process error: ${err.message}`));
    });

    this.process.on('exit', (code) => {
      this.connected = false;
      this.rejectAll(
        new Error(`MCP server "${this.config.name}" exited with code ${code}`),
      );
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      this.stderr.push(chunk.toString());
      // Keep only last 50 lines of stderr for diagnostics
      if (this.stderr.length > 50) this.stderr.shift();
    });

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.parser.feed(chunk);
    });

    this.parser.on('message', (msg: { id?: number; result?: unknown; error?: unknown }) => {
      if (msg.id != null && this.pendingRequests.has(msg.id)) {
        const pending = this.pendingRequests.get(msg.id)!;
        this.pendingRequests.delete(msg.id);

        if (msg.error) {
          const err = msg.error as { message?: string; code?: number };
          pending.reject(new Error(`MCP RPC error: ${err.message ?? JSON.stringify(msg.error)}`));
        } else {
          pending.resolve(msg.result);
        }
      }
      // Notifications (no id) are silently ignored
    });

    // MCP initialization handshake
    await this.initialize();
    this.connected = true;
  }

  private async initialize(): Promise<void> {
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agent-core', version: '0.1.0' },
    }, CONNECT_TIMEOUT_MS);

    if (!result) {
      throw new Error(`MCP server "${this.config.name}" returned empty initialize response`);
    }

    // Send initialized notification (no id, no response expected)
    this.sendNotification('notifications/initialized');
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = (await this.sendRequest('tools/list', undefined, CALL_TIMEOUT_MS)) as {
      tools?: McpToolDefinition[];
    };
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.sendRequest(
      'tools/call',
      { name, arguments: args },
      CALL_TIMEOUT_MS,
    )) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };

    if (result?.isError) {
      const text = result.content?.[0]?.text ?? 'Unknown MCP tool error';
      throw new Error(text);
    }

    // Concatenate all text content blocks
    const parts = (result?.content ?? [])
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!);

    return parts.join('\n') || JSON.stringify(result);
  }

  close(): void {
    this.connected = false;
    this.rejectAll(new Error('Connection closed'));

    if (this.process && !this.process.killed) {
      this.process.stdin?.end();
      this.process.kill('SIGTERM');

      // Force kill after 3 seconds if still alive
      const forceKillTimer = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 3000);
      forceKillTimer.unref();
    }

    this.process = null;
  }

  private sendRequest(method: string, params?: unknown, timeoutMs = CALL_TIMEOUT_MS): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error(`MCP server "${this.config.name}" stdin not writable`));
        return;
      }

      const id = this.nextId++;
      const msg: Record<string, unknown> = { jsonrpc: '2.0', id, method };
      if (params !== undefined) msg.params = params;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref();

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      const encoded = encodeMessage(msg);
      this.process!.stdin!.write(encoded, (err) => {
        if (err) {
          this.pendingRequests.delete(id);
          clearTimeout(timer);
          reject(new Error(`Failed to write to MCP server "${this.config.name}": ${err.message}`));
        }
      });
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    if (!this.process?.stdin?.writable) return;

    const msg: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (params !== undefined) msg.params = params;

    this.process.stdin.write(encodeMessage(msg));
  }

  private rejectAll(err: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      this.pendingRequests.delete(id);
      pending.reject(err);
    }
  }
}
