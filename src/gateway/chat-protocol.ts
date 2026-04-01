/**
 * WebSocket chat protocol between gateway and TUI/dashboard clients.
 *
 * Client → Server:
 *   { type: "message", channelId: string, text: string }
 *   { type: "approval_response", approve: boolean, rewrittenArgs?: Record<string,unknown>, feedback?: string }
 *   { type: "command", channelId: string, name: string, args: string }
 *
 * Server → Client:
 *   { type: "connected", agents: { name, model, status }[] }
 *   { type: "stream", text: string }
 *   { type: "approval_request", toolName: string, args: Record<string,unknown> }
 *   { type: "done", reply: string, usage: { promptTokens, completionTokens }, toolResults: ToolResult[] }
 *   { type: "error", message: string }
 *   { type: "command_result", text: string, action?: string }
 */

export interface ClientMessage {
  type: 'message' | 'approval_response' | 'command';
  channelId?: string;
  text?: string;
  name?: string;
  args?: string;
  approve?: boolean;
  rewrittenArgs?: Record<string, unknown>;
  feedback?: string;
}

export interface ServerMessage {
  type: 'connected' | 'stream' | 'approval_request' | 'done' | 'error' | 'command_result';
  agents?: { name: string; model: string; status: string }[];
  text?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  reply?: string;
  usage?: { promptTokens: number; completionTokens: number };
  toolResults?: { name: string; durationMs: number; error?: string }[];
  message?: string;
  action?: string;
}
