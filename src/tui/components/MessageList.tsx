import React from 'react';
import { Box, Text } from 'ink';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface MessageListProps {
  messages: Message[];
  streamingText: string;
  agentName: string;
}

export function MessageList({ messages, streamingText, agentName }: MessageListProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      {messages.map((msg, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Text bold color={msg.role === 'user' ? 'cyan' : msg.role === 'assistant' ? 'green' : 'yellow'}>
            {msg.role === 'user' ? 'you' : msg.role === 'assistant' ? agentName : 'system'}
          </Text>
          <Box paddingLeft={2}>
            <Text wrap="wrap">{msg.content}</Text>
          </Box>
        </Box>
      ))}
      {streamingText && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="green">{agentName}</Text>
          <Box paddingLeft={2}>
            <Text wrap="wrap">{streamingText}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
