import React from 'react';
import { render } from 'ink';
import type { Router } from '../router/router.js';
import { Chat } from './Chat.js';

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

  const { waitUntilExit } = render(
    React.createElement(Chat, { router, agentName, channelId, verbose }),
  );

  await waitUntilExit();
}
