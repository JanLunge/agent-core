<script setup lang="ts">
import { ref } from 'vue';

interface ToolCallEntry {
  name: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
  error?: string;
}
interface Trace {
  turnIndex: number;
  model: string;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  timestamp: string;
  systemPrompt: string;
  toolCalls: ToolCallEntry[];
  input: { role: string; content: string };
}

const props = defineProps<{ trace: Trace; turnIndex?: number }>();
const emit = defineEmits<{ close: [] }>();

const showPrompt = ref(false);
const expandedTools = ref<Set<number>>(new Set());

function toggleTool(i: number) {
  if (expandedTools.value.has(i)) expandedTools.value.delete(i);
  else expandedTools.value.add(i);
  expandedTools.value = new Set(expandedTools.value);
}
</script>

<template>
  <aside class="inspect">
    <div class="inspect-header">
      <h3>Turn {{ turnIndex ?? trace.turnIndex }}</h3>
      <button class="close-btn" @click="emit('close')">&times;</button>
    </div>
    <div class="inspect-body">
      <!-- Stats -->
      <div class="kv-row"><span class="kv-label">Model</span><span class="kv-value font-mono">{{ trace.model }}</span></div>
      <div class="kv-row"><span class="kv-label">Duration</span><span class="kv-value">{{ trace.durationMs }}ms</span></div>
      <div class="kv-row"><span class="kv-label">Tokens</span><span class="kv-value">{{ trace.promptTokens }}&darr; {{ trace.completionTokens }}&uarr; ({{ trace.promptTokens + trace.completionTokens }})</span></div>
      <div class="kv-row"><span class="kv-label">Time</span><span class="kv-value text-xs">{{ trace.timestamp }}</span></div>

      <!-- Input -->
      <div v-if="trace.input?.content" class="section mt-3">
        <div class="section-title">Input</div>
        <pre class="section-pre">{{ trace.input.content }}</pre>
      </div>

      <!-- Tool Calls -->
      <div v-if="trace.toolCalls?.length" class="section mt-3">
        <div class="section-title">Tool Calls ({{ trace.toolCalls.length }})</div>
        <div v-for="(tc, i) in trace.toolCalls" :key="i" class="tool-card" @click="toggleTool(i)">
          <div class="tool-header">
            <span class="tool-name">{{ tc.name }}</span>
            <span class="tool-dur">{{ tc.durationMs }}ms</span>
            <span v-if="tc.error" class="tool-err">{{ tc.error }}</span>
          </div>
          <div v-if="expandedTools.has(i)" class="tool-detail">
            <pre>{{ JSON.stringify(tc.args, null, 2) }}</pre>
            <pre class="text-muted" style="max-height:120px;overflow:auto">{{ (tc.result || '').substring(0, 500) }}</pre>
          </div>
        </div>
      </div>

      <!-- System Prompt -->
      <div v-if="trace.systemPrompt" class="section mt-3">
        <div class="section-title" style="cursor:pointer" @click="showPrompt = !showPrompt">
          <span :class="['section-arrow', { open: showPrompt }]">&#9654;</span>
          System Prompt
        </div>
        <pre v-if="showPrompt" class="section-pre" style="max-height:300px;overflow:auto">{{ trace.systemPrompt }}</pre>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.inspect {
  flex: 0 0 360px;
  border-left: 1px solid var(--border);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.inspect-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.inspect-header h3 { color: var(--accent-blue); font-size: 13px; }
.close-btn {
  background: none; border: none; color: var(--text-muted);
  cursor: pointer; font-size: 18px; padding: 2px 6px; line-height: 1;
}
.close-btn:hover { color: var(--text-primary); }
.inspect-body { padding: 12px 16px; font-size: 12px; }

.section { }
.section-title {
  font-size: 11px; font-weight: 600; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 6px;
  display: flex; align-items: center; gap: 5px;
}
.section-arrow {
  display: inline-block; font-size: 9px;
  transition: transform var(--transition);
}
.section-arrow.open { transform: rotate(90deg); }
.section-pre {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px;
  font-size: 11px;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-card {
  background: var(--bg-primary);
  border-left: 3px solid var(--accent-yellow);
  padding: 8px 10px;
  margin-bottom: 4px;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  cursor: pointer;
}
.tool-header { display: flex; align-items: center; gap: 6px; }
.tool-name { color: var(--accent-yellow); font-weight: 600; }
.tool-dur { color: var(--text-muted); }
.tool-err { color: var(--accent-red); margin-left: auto; }
.tool-detail { margin-top: 6px; }
.tool-detail pre {
  border: none;
  padding: 4px 0;
  font-size: 11px;
  background: transparent;
}
</style>
