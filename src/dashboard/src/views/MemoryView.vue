<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { apiFetch } from '../composables/useApi';

interface Memory {
  key: string;
  content: string;
  created_at: string;
  updated_at: string;
}

const agentName = ref('');
const query = ref('');
const memories = ref<Memory[]>([]);
const loading = ref(false);
const agents = ref<{ name: string }[]>([]);

onMounted(async () => {
  try {
    const res = await apiFetch<{ agents: { name: string }[] }>('/api/agents');
    agents.value = res.agents || [];
    if (agents.value.length) {
      agentName.value = agents.value[0].name;
      search();
    }
  } catch {}
});

async function search() {
  if (!agentName.value) return;
  loading.value = true;
  try {
    let url = `/api/memory/${encodeURIComponent(agentName.value)}`;
    if (query.value) url += `?query=${encodeURIComponent(query.value)}`;
    const res = await apiFetch<{ memories: Memory[] }>(url);
    memories.value = res.memories || [];
  } catch {
    memories.value = [];
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="view">
    <div class="controls">
      <select v-model="agentName" @change="search">
        <option value="">Select agent</option>
        <option v-for="a in agents" :key="a.name" :value="a.name">{{ a.name }}</option>
      </select>
      <input v-model="query" type="text" placeholder="Search query (optional)" @keydown.enter="search">
      <button class="btn" @click="search">Search</button>
    </div>

    <div v-if="loading" class="empty">Searching...</div>
    <div v-else-if="!memories.length" class="empty">
      {{ agentName ? 'No memories found' : 'Select an agent to browse memories' }}
    </div>
    <template v-else>
      <div class="text-xs text-muted mb-3">{{ memories.length }} memor{{ memories.length === 1 ? 'y' : 'ies' }}</div>
      <div v-for="mem in memories" :key="mem.key" class="memory-card">
        <div class="memory-key">{{ mem.key }}</div>
        <div class="memory-content">{{ mem.content }}</div>
        <div class="memory-meta">Updated: {{ mem.updated_at }} &middot; Created: {{ mem.created_at }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.view { padding: 20px; max-width: 900px; margin: 0 auto; }
.controls {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.controls select, .controls input { max-width: 300px; }
.memory-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent-blue);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  margin-bottom: 8px;
}
.memory-key { color: var(--accent-blue); font-weight: 600; font-size: 13px; }
.memory-content { margin-top: 4px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
.memory-meta { font-size: 11px; color: var(--text-faint); margin-top: 6px; }
</style>
