<script setup lang="ts">
defineProps<{ connected: boolean }>();
</script>

<template>
  <header class="header">
    <h1 class="title">Agent Core</h1>
    <div class="status">
      <span :class="['dot', { connected }]"></span>
      <span class="label">{{ connected ? 'connected' : 'disconnected' }}</span>
    </div>
  </header>
</template>

<style scoped>
.header {
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  padding: 10px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title { font-size: 15px; color: var(--accent-blue); letter-spacing: -0.3px; }
.status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}
.dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--accent-red);
  transition: background var(--transition);
}
.dot.connected { background: var(--accent-green); }
</style>
