<script setup lang="ts">
import { ref } from 'vue';
import { useApi, apiFetch } from '../composables/useApi';

interface Agent {
  name: string;
  model: string;
  role: string;
  status: string;
}

interface AgentDetail {
  name: string;
  model: string;
  role: string;
  status: string;
  systemPrompt?: string;
  tools: { name: string; description: string }[];
  policy?: { auto: string[]; ask: string[]; deny: string[] };
}

const { data, loading } = useApi<{ agents: Agent[] }>('/api/agents');
const expanded = ref<Record<string, AgentDetail | null>>({});

async function toggleAgent(name: string) {
  if (expanded.value[name] !== undefined) {
    delete expanded.value[name];
    expanded.value = { ...expanded.value };
    return;
  }
  expanded.value[name] = null; // loading
  expanded.value = { ...expanded.value };
  try {
    const detail = await apiFetch<AgentDetail>(`/api/agents/${encodeURIComponent(name)}`);
    expanded.value[name] = detail;
    expanded.value = { ...expanded.value };
  } catch {
    delete expanded.value[name];
    expanded.value = { ...expanded.value };
  }
}
</script>

<template>
  <div class="view">
    <div v-if="loading" class="empty">Loading agents...</div>
    <div v-else-if="!data?.agents?.length" class="empty">No agents registered</div>
    <template v-else>
      <div v-for="agent in data.agents" :key="agent.name" class="card">
        <div class="card-header" @click="toggleAgent(agent.name)">
          <div class="flex items-center gap-3">
            <div class="agent-avatar">{{ agent.name[0].toUpperCase() }}</div>
            <div>
              <h3>{{ agent.name }}</h3>
              <div class="text-xs text-muted">{{ agent.role }} &middot; {{ agent.model }}</div>
            </div>
          </div>
          <span :class="['badge', `badge-${agent.status}`]">{{ agent.status }}</span>
        </div>

        <div v-if="expanded[agent.name] !== undefined" class="card-body">
          <div v-if="expanded[agent.name] === null" class="text-sm text-muted" style="padding:12px 0">Loading...</div>
          <template v-else>
            <div class="detail-grid">
              <div class="kv-row">
                <span class="kv-label">Model</span>
                <span class="kv-value font-mono">{{ expanded[agent.name]!.model }}</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">Role</span>
                <span class="kv-value">{{ expanded[agent.name]!.role }}</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">Status</span>
                <span :class="['badge', `badge-${expanded[agent.name]!.status}`]">{{ expanded[agent.name]!.status }}</span>
              </div>
            </div>

            <!-- System Prompt -->
            <div v-if="expanded[agent.name]!.systemPrompt" class="mt-3">
              <h4 class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.3px;margin-bottom:6px">System Prompt</h4>
              <pre class="prompt-pre">{{ expanded[agent.name]!.systemPrompt }}</pre>
            </div>

            <!-- Tools -->
            <div v-if="expanded[agent.name]!.tools?.length" class="mt-3">
              <h4 class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.3px;margin-bottom:6px">
                Tools ({{ expanded[agent.name]!.tools.length }})
              </h4>
              <table>
                <thead><tr><th>Tool</th><th>Description</th></tr></thead>
                <tbody>
                  <tr v-for="tool in expanded[agent.name]!.tools" :key="tool.name">
                    <td class="font-mono" style="color:var(--accent-yellow)">{{ tool.name }}</td>
                    <td class="text-muted">{{ tool.description }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Tool Policy -->
            <div v-if="expanded[agent.name]!.policy" class="mt-3">
              <h4 class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.3px;margin-bottom:6px">Tool Policy</h4>
              <div class="policy-grid">
                <div v-if="expanded[agent.name]!.policy!.auto.length">
                  <span class="badge badge-active">auto</span>
                  <span v-for="p in expanded[agent.name]!.policy!.auto" :key="p" class="font-mono text-xs" style="margin-left:6px">{{ p }}</span>
                </div>
                <div v-if="expanded[agent.name]!.policy!.ask.length">
                  <span class="badge badge-warn">ask</span>
                  <span v-for="p in expanded[agent.name]!.policy!.ask" :key="p" class="font-mono text-xs" style="margin-left:6px">{{ p }}</span>
                </div>
                <div v-if="expanded[agent.name]!.policy!.deny.length">
                  <span class="badge badge-stopped">deny</span>
                  <span v-for="p in expanded[agent.name]!.policy!.deny" :key="p" class="font-mono text-xs" style="margin-left:6px">{{ p }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.view { padding: 20px; max-width: 900px; margin: 0 auto; }
.agent-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: var(--accent-blue);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 600;
}
.detail-grid { padding-top: 4px; }
.prompt-pre { max-height: 200px; overflow: auto; font-size: 11px; }
.policy-grid { display: flex; flex-direction: column; gap: 6px; }
</style>
