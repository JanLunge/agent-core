export interface ApprovalRequest {
  toolName: string;
  args: Record<string, unknown>;
}

export type ApprovalResult =
  | { action: 'approve' }
  | { action: 'deny'; reason?: string }
  | { action: 'rewrite'; args: Record<string, unknown> }
  | { action: 'feedback'; message: string };

/**
 * Callback that asks the user whether to approve a tool call.
 * The implementation depends on the surface (TUI, Telegram, etc.).
 */
export type ApprovalCallback = (request: ApprovalRequest) => Promise<ApprovalResult>;
