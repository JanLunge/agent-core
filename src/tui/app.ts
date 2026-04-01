import * as readline from 'node:readline';
import type { Router } from '../router/router.js';
import type { StreamChunk } from '../llm/types.js';
import { parseCommand } from '../commands/parser.js';
import { handleBuiltin, type CommandContext } from '../commands/builtins.js';
import { createTuiApproval } from './approval.js';

export interface TuiOptions {
  router: Router;
  agentName: string;
  channelId?: string;
  verbose?: boolean;
}

export async function startTui(options: TuiOptions): Promise<void> {
  const { router, agentName, channelId = 'tui-default', verbose = false } = options;

  const agent = router.getAgent(agentName);
  if (!agent) {
    console.error(`Agent "${agentName}" not found`);
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const onApproval = createTuiApproval(rl);

  console.log(`\n  Chatting with ${agent.config.name} (model: ${agent.config.model})`);
  console.log(`  Tools: ${agent.registry.names().join(', ') || 'none'}`);
  console.log(`  Type /help for commands, /quit to exit\n`);

  const prompt = () => {
    rl.question('you: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { prompt(); return; }

      if (trimmed === '/quit' || trimmed === '/exit') {
        console.log('\nGoodbye.');
        rl.close();
        return;
      }

      // Check for /commands
      const cmd = parseCommand(trimmed);
      if (cmd) {
        const conversation = agent.getOrCreateConversation(channelId);
        const cmdContext: CommandContext = {
          agentName: agent.config.name,
          model: agent.config.model,
          conversationId: conversation.id,
          status: agent.status,
        };
        const result = handleBuiltin(cmd.name, cmd.args, cmdContext);
        if (result) {
          console.log(`\n${result.text}\n`);
          prompt();
          return;
        }
        // Unknown command — pass through to LLM
      }

      try {
        process.stdout.write(`\n${agent.config.name}: `);

        const onStream: (chunk: StreamChunk) => void = (chunk) => {
          if (chunk.type === 'text' && chunk.text) {
            process.stdout.write(chunk.text);
          }
        };

        const result = await router.route(
          { channelType: 'tui', chatId: channelId, text: trimmed, sender: 'user' },
          onStream,
          onApproval,
        );

        process.stdout.write('\n');
        if (verbose) {
          console.log(`  [tokens: ${result.usage.promptTokens}in/${result.usage.completionTokens}out, tools: ${result.toolResults.length}]`);
          for (const tr of result.toolResults) {
            const status = tr.error ? `error: ${tr.error}` : `ok (${tr.durationMs.toFixed(0)}ms)`;
            console.log(`  [tool: ${tr.name} → ${status}]`);
          }
        }
        console.log('');
      } catch (err) {
        console.error(`\n  Error: ${err instanceof Error ? err.message : err}\n`);
      }

      prompt();
    });
  };

  prompt();
  await new Promise<void>((resolve) => rl.on('close', resolve));
}
