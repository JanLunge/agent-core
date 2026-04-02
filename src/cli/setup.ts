import * as readline from 'node:readline';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function askYesNo(rl: readline.Interface, question: string, defaultValue = false): Promise<boolean> {
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  return new Promise((resolve) => {
    rl.question(`  ${question} ${hint}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (!a) resolve(defaultValue);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

export async function runSetup(baseDir: string): Promise<void> {
  const configPath = join(baseDir, 'config.yaml');
  let config: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    config = parseYaml(readFileSync(configPath, 'utf-8')) || {};
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  console.log('\n  Agent Core Setup\n');
  console.log('  Secrets (API keys, tokens) are stored in environment');
  console.log('  variables, never in config files.\n');

  // --- LLM Provider ---
  console.log('  -- LLM Provider --');
  const hasProvider = (config.providers as unknown[])?.length > 0;
  if (!hasProvider || await askYesNo(rl, 'Configure LLM provider?', !hasProvider)) {
    const providerType = await ask(rl, 'Provider type (openrouter / openai / local)', 'openrouter');

    let baseUrl: string | undefined;
    let apiKeyEnv: string | undefined;
    let defaultModel: string | undefined;

    if (providerType === 'openrouter') {
      baseUrl = 'https://openrouter.ai/api/v1';
      apiKeyEnv = 'OPENROUTER_API_KEY';
      defaultModel = await ask(rl, 'Default model', 'qwen/qwen3.6-plus-preview:free');
    } else if (providerType === 'openai') {
      apiKeyEnv = 'OPENAI_API_KEY';
      defaultModel = await ask(rl, 'Default model', 'gpt-4o');
    } else {
      baseUrl = await ask(rl, 'Base URL', 'http://localhost:1234/v1');
      defaultModel = await ask(rl, 'Default model', 'local');
    }

    const provider: Record<string, unknown> = {
      name: providerType,
      type: providerType === 'local' ? 'local' : 'openai-compatible',
    };
    if (baseUrl) provider.base_url = baseUrl;
    if (apiKeyEnv) provider.api_key_env = apiKeyEnv;
    if (defaultModel) provider.default_model = defaultModel;

    config.providers = [provider];
    config.default_provider = providerType;
    config.default_model = defaultModel;

    if (apiKeyEnv) {
      const current = process.env[apiKeyEnv];
      if (current) {
        console.log(`  ✓ ${apiKeyEnv} is already set in your environment`);
      } else {
        console.log(`\n  → Set your API key: export ${apiKeyEnv}="your-key-here"`);
      }
    }
  }

  // --- Telegram ---
  console.log('\n  -- Telegram --');
  const telegram = (config.telegram as Record<string, unknown>) || {};
  if (await askYesNo(rl, 'Enable Telegram bot?', false)) {
    telegram.enabled = true;
    // Never store token in config — always use env var
    delete telegram.token;

    const userId = await ask(rl, 'Your Telegram user ID (from @userinfobot)');
    if (userId) {
      telegram.allowed_users = [parseInt(userId, 10)];
    }
    config.telegram = telegram;

    const hasToken = process.env.TELEGRAM_BOT_TOKEN;
    if (hasToken) {
      console.log('  ✓ TELEGRAM_BOT_TOKEN is already set in your environment');
    } else {
      console.log('\n  → Set your bot token: export TELEGRAM_BOT_TOKEN="your-token"');
      console.log('    (Get one from @BotFather on Telegram)');
    }
  } else {
    telegram.enabled = false;
    config.telegram = telegram;
  }

  // --- Agent ---
  console.log('\n  -- Agent --');
  const agentsDir = join(baseDir, (config.agents_dir as string) || 'agents');
  const rolesDir = join(baseDir, (config.roles_dir as string) || 'roles');

  const agentFile = join(agentsDir, 'mira.yaml');
  const hasAgents = existsSync(agentFile);

  if (!hasAgents || await askYesNo(rl, 'Configure agent?', !hasAgents)) {
    const agentName = await ask(rl, 'Agent name', 'Mira');
    const roleName = await ask(rl, 'Role', 'companion');
    const model = await ask(rl, 'Model (or Enter for default)', '');

    // Ensure role exists
    const roleFile = join(rolesDir, `${roleName}.yaml`);
    if (!existsSync(roleFile)) {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(rolesDir, { recursive: true });
      writeFileSync(roleFile, stringifyYaml({
        name: roleName.charAt(0).toUpperCase() + roleName.slice(1),
        description: `A ${roleName} agent`,
      }));
      console.log(`  Created role: ${roleFile}`);
    }

    // Write agent file
    const { mkdirSync } = await import('node:fs');
    mkdirSync(agentsDir, { recursive: true });
    const agentConfigFile = join(agentsDir, `${agentName.toLowerCase()}.yaml`);
    const agentConfig: Record<string, unknown> = {
      name: agentName,
      role: roleName,
      personality: './SOUL.md',
    };
    if (model) agentConfig.model = model;
    writeFileSync(agentConfigFile, stringifyYaml(agentConfig));
    console.log(`  Created agent: ${agentConfigFile}`);
  }

  // --- Scrub any inline secrets that might already be in config ---
  scrubSecrets(config);

  // --- Write config ---
  writeFileSync(configPath, stringifyYaml(config));
  console.log(`\n  Config written to ${configPath}`);

  // --- Summary ---
  console.log('\n  Setup complete! Next steps:');
  const envVarsNeeded: string[] = [];
  if ((config.telegram as Record<string, unknown>)?.enabled && !process.env.TELEGRAM_BOT_TOKEN) {
    envVarsNeeded.push('TELEGRAM_BOT_TOKEN');
  }
  const providers = config.providers as Record<string, unknown>[] | undefined;
  if (providers) {
    for (const p of providers) {
      const envVar = p.api_key_env as string;
      if (envVar && !process.env[envVar]) envVarsNeeded.push(envVar);
    }
  }
  if (envVarsNeeded.length > 0) {
    console.log(`    Set environment variables: ${envVarsNeeded.join(', ')}`);
  }
  console.log('    Run: npx tsx src/cli/index.ts start');
  console.log('    Chat: npx tsx src/cli/index.ts chat\n');

  rl.close();
}

/** Remove any inline secrets from config, replace with env var references. */
function scrubSecrets(config: Record<string, unknown>): void {
  // Scrub provider api_key → api_key_env
  const providers = config.providers as Record<string, unknown>[] | undefined;
  if (providers) {
    for (const p of providers) {
      if (p.api_key && typeof p.api_key === 'string') {
        // Infer the env var name
        const name = (p.name as string || 'default').toUpperCase().replace(/[^A-Z0-9]/g, '_');
        if (!p.api_key_env) {
          p.api_key_env = `${name}_API_KEY`;
        }
        console.log(`  ⚠ Moved inline API key for "${p.name}" to env var ${p.api_key_env}`);
        console.log(`    → export ${p.api_key_env}="${p.api_key}"`);
        delete p.api_key;
      }
    }
  }

  // Scrub telegram token
  const telegram = config.telegram as Record<string, unknown> | undefined;
  if (telegram?.token) {
    console.log(`  ⚠ Moved inline Telegram token to env var TELEGRAM_BOT_TOKEN`);
    console.log(`    → export TELEGRAM_BOT_TOKEN="${telegram.token}"`);
    delete telegram.token;
  }
}
