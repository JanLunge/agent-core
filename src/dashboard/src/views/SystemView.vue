<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { apiFetch } from '../composables/useApi';

interface Provider {
  name: string;
  type: string;
  baseUrl?: string;
  defaultModel?: string;
  hasApiKey: boolean;
}
interface McpServer {
  name: string;
  command: string;
  args?: string[];
  toolCount?: number;
}
interface EmbeddingConfig {
  provider: string;
  model?: string;
  baseUrl?: string;
  dimensions?: number;
}
interface HeartbeatConfig {
  enabled: boolean;
  intervalMinutes: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  promptFile?: string;
}
interface CostStats {
  byModel: { model: string; promptTokens: number; completionTokens: number; estimatedCostUsd: number }[];
  total: { promptTokens: number; completionTokens: number; estimatedCostUsd: number };
}
interface SystemInfo {
  uptime: number;
  dataDir: string;
  providers: Provider[];
  defaultProvider?: string;
  defaultModel?: string;
  mcpServers: McpServer[];
  embeddings?: EmbeddingConfig;
  heartbeat?: HeartbeatConfig;
  costs: CostStats;
  history: { maxTurns: number };
  prompt: { maxTokens: number };
  logging: { level: string };
}

const system = ref<SystemInfo | null>(null);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    system.value = await apiFetch<SystemInfo>('/api/system');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
});

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
</script>

<template>
  <div class="view">
    <div v-if="loading" class="empty">Loading system info...</div>
    <div v-else-if="error" class="empty">Error: {{ error }}</div>
    <template v-else-if="system">

      <!-- Overview Stats -->
      <div class="stat-grid mb-3">
        <div class="stat-box">
          <div class="stat-label">Uptime</div>
          <div class="stat-value">{{ formatUptime(system.uptime) }}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Total Cost</div>
          <div class="stat-value">{{ formatCost(system.costs.total.estimatedCostUsd) }}</div>
          <div class="stat-sub">{{ (system.costs.total.promptTokens + system.costs.total.completionTokens).toLocaleString() }} tokens</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Default Model</div>
          <div class="stat-value font-mono" style="font-size:14px">{{ system.defaultModel || 'none' }}</div>
          <div class="stat-sub">via {{ system.defaultProvider || 'auto' }}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Log Level</div>
          <div class="stat-value">{{ system.logging.level }}</div>
        </div>
      </div>

      <!-- Providers -->
      <section class="section-block">
        <h2 class="section-heading">
          LLM Providers
          <span class="badge badge-info" style="margin-left:8px">{{ system.providers.length }}</span>
        </h2>
        <div v-for="p in system.providers" :key="p.name" class="provider-card">
          <div class="flex items-center justify-between">
            <div>
              <span class="provider-name">{{ p.name }}</span>
              <span class="badge badge-info" style="margin-left:6px">{{ p.type }}</span>
            </div>
            <span :class="['badge', p.hasApiKey ? 'badge-active' : 'badge-stopped']">
              {{ p.hasApiKey ? 'key configured' : 'no key' }}
            </span>
          </div>
          <div class="text-xs text-muted mt-2">
            <span v-if="p.baseUrl" class="font-mono">{{ p.baseUrl }}</span>
            <span v-if="p.defaultModel"> &middot; default: <span class="font-mono">{{ p.defaultModel }}</span></span>
          </div>
        </div>
      </section>

      <!-- MCP Servers -->
      <section class="section-block">
        <h2 class="section-heading">
          MCP Servers
          <span class="badge badge-info" style="margin-left:8px">{{ system.mcpServers.length }}</span>
        </h2>
        <div v-if="!system.mcpServers.length" class="text-sm text-muted">No MCP servers configured</div>
        <div v-for="mcp in system.mcpServers" :key="mcp.name" class="mcp-card">
          <div class="flex items-center justify-between">
            <span class="mcp-name">{{ mcp.name }}</span>
            <span v-if="mcp.toolCount !== undefined" class="badge badge-info">{{ mcp.toolCount }} tools</span>
          </div>
          <div class="text-xs text-muted font-mono mt-2">{{ mcp.command }} {{ (mcp.args || []).join(' ') }}</div>
        </div>
      </section>

      <!-- Embeddings -->
      <section class="section-block">
        <h2 class="section-heading">Embeddings</h2>
        <div v-if="!system.embeddings" class="text-sm text-muted">Not configured (memory search will use FTS only)</div>
        <div v-else>
          <div class="kv-row"><span class="kv-label">Provider</span><span class="kv-value">{{ system.embeddings.provider }}</span></div>
          <div class="kv-row"><span class="kv-label">Model</span><span class="kv-value font-mono">{{ system.embeddings.model || 'default' }}</span></div>
          <div v-if="system.embeddings.baseUrl" class="kv-row"><span class="kv-label">URL</span><span class="kv-value font-mono">{{ system.embeddings.baseUrl }}</span></div>
          <div v-if="system.embeddings.dimensions" class="kv-row"><span class="kv-label">Dimensions</span><span class="kv-value">{{ system.embeddings.dimensions }}</span></div>
        </div>
      </section>

      <!-- Heartbeat -->
      <section class="section-block">
        <h2 class="section-heading">Heartbeat</h2>
        <div class="kv-row">
          <span class="kv-label">Enabled</span>
          <span :class="['badge', system.heartbeat?.enabled ? 'badge-active' : 'badge-ended']">
            {{ system.heartbeat?.enabled ? 'on' : 'off' }}
          </span>
        </div>
        <template v-if="system.heartbeat?.enabled">
          <div class="kv-row"><span class="kv-label">Interval</span><span class="kv-value">{{ system.heartbeat.intervalMinutes }} min</span></div>
          <div v-if="system.heartbeat.quietHoursStart != null" class="kv-row">
            <span class="kv-label">Quiet Hours</span>
            <span class="kv-value">{{ system.heartbeat.quietHoursStart }}:00 – {{ system.heartbeat.quietHoursEnd }}:00</span>
          </div>
          <div v-if="system.heartbeat.promptFile" class="kv-row"><span class="kv-label">Prompt File</span><span class="kv-value font-mono">{{ system.heartbeat.promptFile }}</span></div>
        </template>
      </section>

      <!-- Cost Breakdown -->
      <section v-if="system.costs.byModel.length" class="section-block">
        <h2 class="section-heading">Cost Breakdown</h2>
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th style="text-align:right">Prompt Tokens</th>
              <th style="text-align:right">Completion Tokens</th>
              <th style="text-align:right">Est. Cost</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in system.costs.byModel" :key="row.model">
              <td class="font-mono">{{ row.model }}</td>
              <td style="text-align:right">{{ row.promptTokens.toLocaleString() }}</td>
              <td style="text-align:right">{{ row.completionTokens.toLocaleString() }}</td>
              <td style="text-align:right;color:var(--accent-green)">{{ formatCost(row.estimatedCostUsd) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Config -->
      <section class="section-block">
        <h2 class="section-heading">Configuration</h2>
        <div class="kv-row"><span class="kv-label">Data Directory</span><span class="kv-value font-mono">{{ system.dataDir }}</span></div>
        <div class="kv-row"><span class="kv-label">Max History Turns</span><span class="kv-value">{{ system.history.maxTurns }}</span></div>
        <div class="kv-row"><span class="kv-label">Max Prompt Tokens</span><span class="kv-value">{{ system.prompt.maxTokens.toLocaleString() }}</span></div>
      </section>

    </template>
  </div>
</template>

<style scoped>
.view { padding: 20px; max-width: 900px; margin: 0 auto; overflow-y: auto; max-height: calc(100vh - 88px); }
.section-block { margin-bottom: 24px; }
.section-heading {
  font-size: 14px;
  color: var(--text-primary);
  margin-bottom: 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-light);
  display: flex;
  align-items: center;
}
.provider-card, .mcp-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  margin-bottom: 8px;
}
.provider-name, .mcp-name { font-weight: 600; color: var(--text-primary); font-size: 13px; }
</style>
