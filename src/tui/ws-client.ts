import WebSocket from 'ws';
import * as readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import type { ClientMessage, ServerMessage } from '../gateway/chat-protocol.js';
import { parseCommand } from '../commands/parser.js';

export interface WsClientOptions {
  url: string;
  channelId?: string;
  verbose?: boolean;
}

export async function startWsChat(options: WsClientOptions): Promise<void> {
  const { url, channelId = `tui-${randomUUID().slice(0, 8)}`, verbose = false } = options;

  return new Promise<void>((resolveExit) => {
    const ws = new WebSocket(url);
    let agentName = 'Agent';
    let model = '';
    let waitingForInput = false;

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    function send(msg: ClientMessage): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    }

    function prompt(): void {
      waitingForInput = true;
      rl.question('you: ', (input) => {
        waitingForInput = false;
        const trimmed = input.trim();
        if (!trimmed) { prompt(); return; }

        if (trimmed === '/quit' || trimmed === '/exit') {
          console.log('\nGoodbye.');
          ws.close();
          rl.close();
          resolveExit();
          return;
        }

        // Check for slash commands — send to server
        const cmd = parseCommand(trimmed);
        if (cmd) {
          send({ type: 'command', channelId, name: cmd.name, args: cmd.args });
          return;
        }

        // Send message
        process.stdout.write(`\n${agentName}: `);
        send({ type: 'message', channelId, text: trimmed });
      });
    }

    ws.on('open', () => {
      // Wait for 'connected' message before prompting
    });

    ws.on('message', (raw) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(raw.toString()); }
      catch { return; }

      switch (msg.type) {
        case 'connected':
          if (msg.agents && msg.agents.length > 0) {
            agentName = msg.agents[0].name;
            model = msg.agents[0].model;
          }
          console.log(`\n  Connected to gateway at ${url}`);
          console.log(`  Agent: ${agentName} (${model})`);
          console.log(`  Channel: ${channelId}`);
          console.log(`  Type /help for commands, /quit to exit\n`);
          prompt();
          break;

        case 'stream':
          if (msg.text) process.stdout.write(msg.text);
          break;

        case 'approval_request':
          // Pause any streaming output and ask user
          console.log(`\n\n  ┌─ Tool call: ${msg.toolName}`);
          console.log(`  │`);
          if (msg.args) {
            for (const [k, v] of Object.entries(msg.args)) {
              const val = typeof v === 'string' && v.length > 200
                ? v.slice(0, 200) + '...'
                : JSON.stringify(v);
              console.log(`  │     ${k}: ${val}`);
            }
          }
          console.log(`  │`);
          console.log(`  │  [y] approve  [n] deny  [f] feedback`);
          rl.question('  └─ ', (input) => {
            const t = input.trim().toLowerCase();
            if (t === 'n' || t === 'no') {
              send({ type: 'approval_response', approve: false });
            } else if (t === 'f' || t === 'feedback') {
              console.log(`  │  Enter feedback:`);
              rl.question('  │  > ', (fb) => {
                send({ type: 'approval_response', approve: false, feedback: fb.trim() });
                process.stdout.write(`\n${agentName}: `);
              });
              return;
            } else {
              send({ type: 'approval_response', approve: true });
            }
            process.stdout.write(`\n${agentName}: `);
          });
          break;

        case 'done':
          process.stdout.write('\n');
          if (verbose && msg.usage) {
            console.log(`  [tokens: ${msg.usage.promptTokens}↓ ${msg.usage.completionTokens}↑]`);
            if (msg.toolResults) {
              for (const tr of msg.toolResults) {
                const status = tr.error ? `error: ${tr.error}` : `ok (${tr.durationMs.toFixed(0)}ms)`;
                console.log(`  [tool: ${tr.name} → ${status}]`);
              }
            }
          }
          console.log('');
          prompt();
          break;

        case 'command_result':
          console.log(`\n${msg.text}\n`);
          prompt();
          break;

        case 'error':
          console.error(`\n  Error: ${msg.message}\n`);
          prompt();
          break;
      }
    });

    ws.on('error', (err) => {
      console.error(`\n  Connection error: ${err.message}`);
      console.error(`  Is \`agent-core start\` running?\n`);
      rl.close();
      resolveExit();
    });

    ws.on('close', () => {
      if (waitingForInput) {
        console.log('\n  Connection closed by server.');
        rl.close();
        resolveExit();
      }
    });
  });
}
