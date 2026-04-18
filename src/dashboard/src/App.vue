<script setup lang="ts">
import { ref, shallowRef, onUnmounted } from 'vue';
import { useWebSocket } from './composables/useWebSocket';
import AppHeader from './components/AppHeader.vue';
import AgentsView from './views/AgentsView.vue';
import ChatView from './views/ChatView.vue';
import TracesView from './views/TracesView.vue';
import MemoryView from './views/MemoryView.vue';
import ToolsView from './views/ToolsView.vue';
import SystemView from './views/SystemView.vue';

const tabs = [
  { id: 'agents', label: 'Agents', component: AgentsView },
  { id: 'chat', label: 'Chat', component: ChatView },
  { id: 'traces', label: 'Traces', component: TracesView },
  { id: 'memory', label: 'Memory', component: MemoryView },
  { id: 'tools', label: 'Tools', component: ToolsView },
  { id: 'system', label: 'System', component: SystemView },
] as const;

const activeTab = ref('agents');
const currentComponent = shallowRef(tabs[0].component);

function switchTab(id: string) {
  activeTab.value = id;
  const tab = tabs.find(t => t.id === id);
  if (tab) currentComponent.value = tab.component;
}

const ws = useWebSocket();
onUnmounted(() => ws.close());
</script>

<template>
  <AppHeader :connected="ws.connected.value" />
  <nav class="tabs">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      :class="['tab', { active: activeTab === tab.id }]"
      @click="switchTab(tab.id)"
    >
      {{ tab.label }}
    </button>
  </nav>
  <main class="main-content">
    <component :is="currentComponent" :ws="ws" />
  </main>
</template>

<style scoped>
.tabs {
  display: flex;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  padding: 0 20px;
  gap: 2px;
}
.tab {
  padding: 10px 18px;
  cursor: pointer;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  font-family: var(--font-sans);
  transition: color var(--transition), border-color var(--transition);
}
.tab:hover { color: var(--text-secondary); }
.tab.active { color: var(--accent-blue); border-bottom-color: var(--accent-blue); }

.main-content {
  flex: 1;
  overflow: hidden;
}
</style>
