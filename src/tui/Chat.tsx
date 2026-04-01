import React, { useState, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { Router } from '../router/router.js';
import type { StreamChunk } from '../llm/types.js';
import type { ApprovalRequest, ApprovalResult } from '../tools/approval.js';
import { parseCommand } from '../commands/parser.js';
import { handleBuiltin, type CommandContext } from '../commands/builtins.js';
import { MessageList, type Message } from './components/MessageList.js';
import { StatusBar } from './components/StatusBar.js';
import { ToolApproval } from './components/ToolApproval.js';
import { ChatInput } from './components/ChatInput.js';

interface AppProps {
  router: Router;
  agentName: string;
  channelId: string;
  verbose: boolean;
}

export function Chat({ router, agentName, channelId, verbose }: AppProps) {
  const { exit } = useApp();
  const agent = router.getAgent(agentName)!;

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'system',
      content: `Chatting with ${agent.config.name} (${agent.config.model}). Tools: ${agent.registry.names().join(', ') || 'none'}. Type /help for commands, /quit to exit.`,
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [tokenInfo, setTokenInfo] = useState('');
  const [pendingApproval, setPendingApproval] = useState<{
    request: ApprovalRequest;
    resolve: (result: ApprovalResult) => void;
  } | null>(null);

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      exit();
    }
  });

  const onApproval = useCallback(
    (request: ApprovalRequest): Promise<ApprovalResult> =>
      new Promise((resolve) => {
        setPendingApproval({ request, resolve });
      }),
    [],
  );

  const handleApprovalResult = useCallback(
    (result: ApprovalResult) => {
      if (pendingApproval) {
        pendingApproval.resolve(result);
        setPendingApproval(null);
      }
    },
    [pendingApproval],
  );

  const handleSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setInputValue('');

      if (trimmed === '/quit' || trimmed === '/exit') {
        exit();
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
          setMessages((prev) => [...prev, { role: 'system', content: result.text }]);
          return;
        }
      }

      // Add user message
      setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
      setIsRunning(true);
      setStreamingText('');

      try {
        const onStream = (chunk: StreamChunk) => {
          if (chunk.type === 'text' && chunk.text) {
            setStreamingText((prev) => prev + chunk.text);
          }
        };

        const result = await router.route(
          { channelType: 'tui', chatId: channelId, text: trimmed, sender: 'user' },
          onStream,
          onApproval,
        );

        // Move streaming text into messages
        setStreamingText((current) => {
          if (current) {
            setMessages((prev) => [...prev, { role: 'assistant', content: current }]);
          }
          return '';
        });

        if (verbose) {
          const toolInfo = result.toolResults
            .map((tr) => {
              const status = tr.error ? `error: ${tr.error}` : `ok (${tr.durationMs.toFixed(0)}ms)`;
              return `${tr.name} → ${status}`;
            })
            .join(', ');
          setTokenInfo(`${result.usage.promptTokens}↓ ${result.usage.completionTokens}↑${toolInfo ? ` | ${toolInfo}` : ''}`);
        }
      } catch (err) {
        setStreamingText('');
        setMessages((prev) => [
          ...prev,
          { role: 'system', content: `Error: ${err instanceof Error ? err.message : err}` },
        ]);
      } finally {
        setIsRunning(false);
      }
    },
    [agent, channelId, verbose, router, onApproval, exit],
  );

  return (
    <Box flexDirection="column" height="100%">
      <StatusBar
        agentName={agent.config.name}
        model={agent.config.model}
        status={isRunning ? 'running' : 'idle'}
        tokenInfo={verbose ? tokenInfo : undefined}
      />

      <Box flexDirection="column" flexGrow={1} paddingY={1}>
        <MessageList
          messages={messages}
          streamingText={streamingText}
          agentName={agent.config.name}
        />
      </Box>

      {pendingApproval ? (
        <ToolApproval
          request={pendingApproval.request}
          onResult={handleApprovalResult}
        />
      ) : (
        <ChatInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          disabled={isRunning}
        />
      )}
    </Box>
  );
}
