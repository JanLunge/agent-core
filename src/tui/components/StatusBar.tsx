import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { AgentStatus } from '../../agent/agent.js';

interface StatusBarProps {
  agentName: string;
  model: string;
  status: AgentStatus;
  tokenInfo?: string;
}

export function StatusBar({ agentName, model, status, tokenInfo }: StatusBarProps) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
      <Box gap={2}>
        <Text bold color="cyan">{agentName}</Text>
        <Text dimColor>{model}</Text>
      </Box>
      <Box gap={2}>
        {tokenInfo && <Text dimColor>{tokenInfo}</Text>}
        {status === 'running' ? (
          <Text color="yellow"><Spinner type="dots" /> thinking</Text>
        ) : (
          <Text color="green">● ready</Text>
        )}
      </Box>
    </Box>
  );
}
