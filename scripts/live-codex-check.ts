import { loadConfig } from '../src/config/loader.js';
import { createProvider } from '../src/llm/client.js';

const cfg = loadConfig('.');
const agent = [...cfg.resolved.values()][0];
if (!agent) throw new Error('No agent configured');
const profile = cfg.master.providers.find((p) => p.name === agent.provider);
if (!profile) throw new Error(`Provider not found: ${agent.provider}`);

const provider = createProvider(profile);
const response = await provider.complete({
  model: agent.model,
  messages: [{ role: 'user', content: 'Reply with exactly: agent-core-live-ok' }],
  max_tokens: 16,
});

console.log(JSON.stringify({
  provider: agent.provider,
  modelRequested: agent.model,
  modelReturned: response.model,
  content: response.content,
  finishReason: response.finishReason,
}, null, 2));
