<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { apiFetch } from '../composables/useApi';

interface ToolStat {
  name: string;
  calls: number;
  avgDurationMs: number;
  errors: number;
  totalDurationMs: number;
}

interface AgentTool {
  name: string;
  description: string;
}

interface AgentTools {
  agentName: string;
  tools: AgentTool[];
}

const stats = ref<ToolStat[]>([]);
const agentTools = ref<AgentTools[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const [statsRes, agentsRes] = await Promise.all([
      apiFetch<{ stats: ToolStat[] }>('/api/tools/stats'),
      apiFetch<{ agents: { name: string }[] }>('/api/agents'),
    ]);
    stats.value = (statsRes.stats || []).sort((a, b) => b.calls - a.calls);

    // Load tool details for each agent
    const details: AgentTools[] = [];
    for (const agent of agentsRes.agents || []) {
      try {
        const detail = await apiFetch<{ name: string; tools: AgentTool[] }>(`/api/agents/${encodeURIComponent(agent.name)}`);
        details.push({ agentName: agent.name, tools: detail.tools || [] });
      } catch {}
    }
    agentTools.value = details;
  } catch {} finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="view">
    <div v-if="loading" class="empty">Loading tools...</div>
    <template v-else>
      <!-- Usage Stats -->
      <section class="mb-3">
        <h2 class="section-heading">Tool Usage</h2>
        <div v-if="!stats.length" class="empty">No tool usage recorded yet</div>
        <table v-else>
          <thead>
            <tr>
              <th>Tool</th>
              <th style="text-align:right">Calls</th>
              <th style="text-align:right">Avg Duration</th>
              <th style="text-align:right">Errors</th>
              <th style="text-align:right">Total Time</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in stats" :key="s.name">
              <td class="font-mono" style="color:var(--accent-yellow)">{{ s.name }}</td>
              <td style="text-align:right">{{ s.calls }}</td>
              <td style="text-align:right">{{ s.avgDurationMs }}ms</td>
              <td style="text-align:right">
                <span v-if="s.errors" style="color:var(--accent-red)">{{ s.errors }}</span>
                <span v-else class="text-faint">0</span>
              </td>
              <td style="text-align:right" class="text-muted">{{ s.totalDurationMs }}ms</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Tool Registry per agent -->
      <section>
        <h2 class="section-heading">Tool Registry</h2>
        <div v-for="at in agentTools" :key="at.agentName" class="card" style="margin-bottom:12px">
          <div class="card-header" style="cursor:default">
            <h3>{{ at.agentName }}</h3>
            <span class="badge badge-info">{{ at.tools.length }} tools</span>
          </div>
          <div class="card-body" style="display:block">
            <table>
              <thead><tr><th>Tool</th><th>Description</th></tr></thead>
              <tbody>
                <tr v-for="t in at.tools" :key="t.name">
                  <td class="font-mono text-sm" style="color:var(--accent-yellow);white-space:nowrap">{{ t.name }}</td>
                  <td class="text-muted text-sm">{{ t.description }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.view { padding: 20px; max-width: 1000px; margin: 0 auto; }
.section-heading {
  font-size: 14px;
  color: var(--text-primary);
  margin-bottom: 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-light);
}
</style>
