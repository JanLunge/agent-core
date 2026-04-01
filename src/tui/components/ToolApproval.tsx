import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { ApprovalRequest, ApprovalResult } from '../../tools/approval.js';

interface ToolApprovalProps {
  request: ApprovalRequest;
  onResult: (result: ApprovalResult) => void;
}

function formatArgs(args: Record<string, unknown>): string[] {
  const entries = Object.entries(args);
  if (entries.length === 0) return ['(no arguments)'];
  return entries.map(([k, v]) => {
    const val = typeof v === 'string' && v.length > 200
      ? v.slice(0, 200) + '...'
      : JSON.stringify(v);
    return `${k}: ${val}`;
  });
}

export function ToolApproval({ request, onResult }: ToolApprovalProps) {
  const [mode, setMode] = useState<'prompt' | 'edit' | 'feedback'>('prompt');
  const [inputValue, setInputValue] = useState('');
  const argLines = formatArgs(request.args);

  useInput((input, key) => {
    if (mode !== 'prompt') return;

    if (input === 'y' || key.return) {
      onResult({ action: 'approve' });
    } else if (input === 'n') {
      onResult({ action: 'deny', reason: 'User denied the tool call.' });
    } else if (input === 'e') {
      setMode('edit');
    } else if (input === 'f') {
      setMode('feedback');
    }
  });

  const handleEditSubmit = (value: string) => {
    try {
      const newArgs = JSON.parse(value);
      onResult({ action: 'rewrite', args: newArgs });
    } catch {
      // Try key=value parsing
      const result = { ...request.args };
      const pairs = value.split(/\s+/);
      for (const pair of pairs) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx > 0) {
          result[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
        }
      }
      onResult({ action: 'rewrite', args: result });
    }
  };

  const handleFeedbackSubmit = (value: string) => {
    onResult({ action: 'feedback', message: value.trim() });
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginX={1}>
      <Text bold color="yellow">⚡ Tool call: {request.toolName}</Text>
      <Box flexDirection="column" paddingLeft={2} marginY={1}>
        {argLines.map((line, i) => (
          <Text key={i} dimColor>{line}</Text>
        ))}
      </Box>

      {mode === 'prompt' && (
        <Box gap={2}>
          <Text><Text bold color="green">[y]</Text> approve</Text>
          <Text><Text bold color="red">[n]</Text> deny</Text>
          <Text><Text bold color="blue">[e]</Text> edit</Text>
          <Text><Text bold color="magenta">[f]</Text> feedback</Text>
        </Box>
      )}

      {mode === 'edit' && (
        <Box>
          <Text color="blue">args: </Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleEditSubmit}
          />
        </Box>
      )}

      {mode === 'feedback' && (
        <Box>
          <Text color="magenta">feedback: </Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleFeedbackSubmit}
          />
        </Box>
      )}
    </Box>
  );
}
