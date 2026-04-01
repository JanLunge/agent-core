import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

export function ChatInput({ value, onChange, onSubmit, disabled = false }: ChatInputProps) {
  if (disabled) {
    return (
      <Box paddingX={1}>
        <Text dimColor>waiting for response...</Text>
      </Box>
    );
  }

  return (
    <Box paddingX={1}>
      <Text bold color="cyan">{'> '}</Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder="Type a message..."
      />
    </Box>
  );
}
