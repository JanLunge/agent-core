<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { apiFetch } from '../composables/useApi';
import type { WebSocketState, WsMessage } from '../composables/useWebSocket';

const props = defineProps<{ ws: WebSocketState }>();

interface Conversation {
  id: string;
  agentName: string;
  channelId: string;
  status: string;
  messageCount: number;
  lastMessageAt?: string;
  lastMessageExcerpt?: string;
}
interface Trace {
  id: number;
  conversationId: string;
  turnIndex: number;
  timestamp: string;
  input: { role: string; content: string };
  systemPrompt: string;
  messages: { role: string; content: string; timestamp?: string }[];
  promptTokens: number;
  completionTokens: number;
  model: string;
  toolCalls: { name: string; args: Record<string, unknown>; result: string; durationMs: number; error?: string }[];
  reply: string;
  durationMs: number;
}

const conversations = ref<Conversation[]>([]);
const selectedConvId = ref('');
const traces = ref<Trace[]>([]);
const expandedTraces = ref<Set<number>>(new Set());
const expandedSections = ref<Set<string>>(new Set());

onMounted(loadConversations);

async function loadConversations() {
  try {
    const res = await apiFetch<{ conversations: Conversation[] }>('/api/conversations');
    conversations.value = (res.conversations || []).sort((a, b) =>
      (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '')
    );
    if (!selectedConvId.value && conversations.value.length) {
      selectConversation(conversations.value[0].id);
    }
  } catch {}
}

async function selectConversation(id: string) {
  selectedConvId.value = id;
  expandedTraces.value = new Set();
  expandedSections.value = new Set();
  try {
    const res = await apiFetch<{ traces: Trace[] }>(`/api/conversations/${encodeURIComponent(id)}/traces`);
    traces.value = res.traces || [];
    // Expand first trace by default
    if (traces.value.length) expandedTraces.value.add(traces.value[0].id);
  } catch {}
}

function toggleTrace(id: number) {
  if (expandedTraces.value.has(id)) expandedTraces.value.delete(id);
  else expandedTraces.value.add(id);
  expandedTraces.value = new Set(expandedTraces.value);
}

function toggleSection(key: string) {
  if (expandedSections.value.has(key)) expandedSections.value.delete(key);
  else expandedSections.value.add(key);
  expandedSections.value = new Set(expandedSections.value);
}

function estimateTokens(text: string) { return Math.ceil(text.length / 4); }

// Live trace updates
let unsub: (() => void) | null = null;
onMounted(() => {
  unsub = props.ws.onMessage((msg: WsMessage) => {
    if (msg.type === 'trace' && (msg.data as Trace)?.conversationId === selectedConvId.value) {
      traces.value.unshift(msg.data as Trace);
    }
  });
});
onUnmounted(() => unsub?.());
</script>

<template>
  <div class="traces-layout">
    <!-- Conversation list -->
    <div class="conv-list">
      <div
        v-for="c in conversations" :key="c.id"
        :class="['conv-item', { selected: c.id === selectedConvId }]"
        @click="selectConversation(c.id)"
      >
        <div class="conv-agent">{{ c.agentName }} <span :class="['badge', c.status === 'active' ? 'badge-active' : 'badge-ended']">{{ c.status }}</span></div>
        <div class="text-xs text-muted">{{ c.messageCount }} msgs &middot; {{ c.channelId }}</div>
        <div v-if="c.lastMessageExcerpt" class="conv-excerpt">{{ c.lastMessageExcerpt }}</div>
      </div>
      <div v-if="!conversations.length" class="empty" style="padding:20px">No conversations</div>
    </div>

    <!-- Trace list -->
    <div class="trace-area">
      <div v-if="!selectedConvId" class="empty">Select a conversation</div>
      <div v-else-if="!traces.length" class="empty">No traces for this conversation</div>
      <template v-else>
        <div v-for="trace in traces" :key="trace.id" class="card">
          <div class="card-header" @click="toggleTrace(trace.id)">
            <h3>
              Turn {{ trace.turnIndex }}
              <span class="text-xs text-faint" style="margin-left:6px">{{ trace.timestamp ? new Date(trace.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '' }}</span>
            </h3>
            <div class="text-xs text-muted">
              {{ trace.promptTokens + trace.completionTokens }} tok &middot; {{ trace.durationMs }}ms &middot; {{ trace.toolCalls?.length || 0 }} tools &middot; {{ trace.model }}
            </div>
          </div>

          <div v-if="expandedTraces.has(trace.id)" class="card-body">
            <!-- Chat bubbles -->
            <template v-for="m in (trace.messages || []).filter(m => m.role === 'user' || m.role === 'assistant')" :key="m.content">
              <div :class="['bubble', `bubble-${m.role}`]">
                <div :class="['bubble-role', m.role]">{{ m.role }}</div>
                {{ m.content }}
              </div>
            </template>
            <div class="bubble bubble-assistant">
              <div class="bubble-role assistant">assistant</div>
              {{ trace.reply }}
            </div>

            <!-- System Prompt (foldable) -->
            <div v-if="trace.systemPrompt" class="mt-3">
              <div class="section-header" @click="toggleSection(`sys-${trace.id}`)">
                <span :class="['section-arrow', { open: expandedSections.has(`sys-${trace.id}`) }]">&#9654;</span>
                System Prompt (~{{ estimateTokens(trace.systemPrompt) }} tokens)
              </div>
              <pre v-if="expandedSections.has(`sys-${trace.id}`)" style="max-height:250px;overflow:auto">{{ trace.systemPrompt }}</pre>
            </div>

            <!-- Tool Calls (foldable) -->
            <div v-if="trace.toolCalls?.length" class="mt-3">
              <div class="section-header" @click="toggleSection(`tools-${trace.id}`)">
                <span :class="['section-arrow', { open: expandedSections.has(`tools-${trace.id}`) }]">&#9654;</span>
                Tool Calls ({{ trace.toolCalls.length }})
              </div>
              <div v-if="expandedSections.has(`tools-${trace.id}`)">
                <div v-for="(tc, i) in trace.toolCalls" :key="i" class="tool-call">
                  <span class="tool-name">{{ tc.name }}</span>
                  <span class="tool-dur">{{ tc.durationMs }}ms</span>
                  <span v-if="tc.error" style="color:var(--accent-red);margin-left:8px">{{ tc.error }}</span>
                  <pre style="margin-top:4px;border:none;padding:2px 0;background:transparent">{{ JSON.stringify(tc.args, null, 2) }}</pre>
                  <pre style="border:none;padding:2px 0;background:transparent;color:var(--text-muted);max-height:200px;overflow:auto">{{ (tc.result || '').substring(0, 500) }}</pre>
                </div>
              </div>
            </div>

            <!-- Stats footer -->
            <div class="text-xs text-faint mt-3">
              {{ trace.promptTokens }}&darr; {{ trace.completionTokens }}&uarr; &middot; {{ trace.durationMs }}ms &middot; {{ trace.timestamp }}
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.traces-layout { display: flex; height: calc(100vh - 88px); }
.conv-list {
  flex: 0 0 300px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  background: var(--bg-secondary);
}
.conv-item {
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-light);
  transition: background var(--transition);
}
.conv-item:hover { background: var(--bg-hover); }
.conv-item.selected { background: var(--bg-active); border-left: 3px solid var(--accent-blue); }
.conv-agent { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.conv-excerpt {
  font-size: 12px; color: var(--text-faint); margin-top: 3px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.trace-area { flex: 1; overflow-y: auto; padding: 16px 20px; }

.bubble {
  padding: 8px 12px; margin: 4px 0; border-radius: var(--radius-lg);
  font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
}
.bubble-user { background: rgba(31,111,235,0.12); border-left: 3px solid var(--accent-blue); }
.bubble-assistant { background: var(--bg-tertiary); border-left: 3px solid var(--accent-green); }
.bubble-role { font-size: 11px; font-weight: 600; margin-bottom: 2px; }
.bubble-role.user { color: var(--accent-blue); }
.bubble-role.assistant { color: var(--accent-green); }

.tool-call {
  background: var(--bg-tertiary);
  border-left: 3px solid var(--accent-yellow);
  padding: 8px 12px;
  margin: 4px 0;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: 12px;
}
.tool-name { color: var(--accent-yellow); font-weight: 600; }
.tool-dur { color: var(--text-muted); margin-left: 8px; }
</style>
