import type { Interface as ReadlineInterface } from 'node:readline';
import type { ApprovalRequest, ApprovalResult } from '../tools/approval.js';

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '(no arguments)';
  return entries
    .map(([k, v]) => {
      const val = typeof v === 'string' && v.length > 200
        ? v.slice(0, 200) + '...'
        : JSON.stringify(v);
      return `    ${k}: ${val}`;
    })
    .join('\n');
}

export function createTuiApproval(rl: ReadlineInterface): (request: ApprovalRequest) => Promise<ApprovalResult> {
  return async (request: ApprovalRequest): Promise<ApprovalResult> => {
    console.log(`\n  ┌─ Tool call: ${request.toolName}`);
    console.log(`  │`);
    const argLines = formatArgs(request.args);
    for (const line of argLines.split('\n')) {
      console.log(`  │ ${line}`);
    }
    console.log(`  │`);
    console.log(`  │  [y] approve  [n] deny  [e] edit args  [f] feedback`);

    return new Promise<ApprovalResult>((resolve) => {
      const ask = () => {
        rl.question('  └─ ', (input) => {
          const trimmed = input.trim().toLowerCase();

          if (trimmed === 'y' || trimmed === 'yes' || trimmed === '') {
            resolve({ action: 'approve' });
            return;
          }

          if (trimmed === 'n' || trimmed === 'no') {
            resolve({ action: 'deny', reason: 'User denied the tool call.' });
            return;
          }

          if (trimmed === 'e' || trimmed === 'edit') {
            console.log(`  │  Enter new args as JSON (or key=value pairs):`);
            rl.question('  │  > ', (argsInput) => {
              const newArgs = parseArgsInput(argsInput.trim(), request.args);
              resolve({ action: 'rewrite', args: newArgs });
            });
            return;
          }

          if (trimmed === 'f' || trimmed === 'feedback') {
            console.log(`  │  Enter feedback for the agent:`);
            rl.question('  │  > ', (feedback) => {
              resolve({ action: 'feedback', message: feedback.trim() });
            });
            return;
          }

          console.log(`  │  Please enter y, n, e, or f`);
          ask();
        });
      };
      ask();
    });
  };
}

function parseArgsInput(
  input: string,
  original: Record<string, unknown>,
): Record<string, unknown> {
  try {
    return JSON.parse(input);
  } catch {
    // Fall back to key=value parsing
  }

  const result = { ...original };
  const pairs = input.split(/\s+/);
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      const key = pair.slice(0, eqIdx);
      const value = pair.slice(eqIdx + 1);
      result[key] = value;
    }
  }
  return result;
}
