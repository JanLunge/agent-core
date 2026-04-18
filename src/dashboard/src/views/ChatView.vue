<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { apiFetch } from '../composables/useApi';
import type { WebSocketState, WsMessage } from '../composables/useWebSocket';
import ChatInspect from '../components/ChatInspect.vue';

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
interface ChatMsg {
  id?: number;
  role: string;
  content: string;
  name?: string;
  timestamp?: string;
}
interface Trace {
  id: number;
  conversationId: string;
  turnIndex: number;
  timestamp: string;
  input: { role: string; content: string };
  systemPrompt: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  toolCalls: { name: string; args: Record<string, unknown>; result: string; durationMs: number; error?: string }[];
  reply: string;
  durationMs: number;
}
interface Turn {
  index: number;
  userMsg: ChatMsg;
  messages: ChatMsg[];
  trace?: Trace;
}
interface Agent { name: string; model: string; status: string }

const agents = ref<Agent[]>([]);
const agentFilter = ref('');
const conversations = ref<Conversation[]>([]);
const activeConvId = ref<string | null>(null);
const channelId = ref<string | null>(null);
const messages = ref<ChatMsg[]>([]);
const traces = ref<Trace[]>([]);
const turns = ref<Turn[]>([]);

const inputText = ref('');
const streaming = ref(false);
const streamText = ref('');
const selectedTurn = ref<Turn | null>(null);
const inspectTrace = ref<Trace | null>(null);

// Approval state
const approval = ref<{ toolName: string; args: Record<string, unknown> } | null>(null);
const feedbackMode = ref(false);
const feedbackText = ref('');

const messagesEl = ref<HTMLElement | null>(null);

// Load agents
onMounted(async () => {
  try {
    const res = await apiFetch<{ agents: Agent[] }>('/api/agents');
    agents.value = res.agents || [];
  } catch {}
  loadConversations();
});

async function loadConversations() {
  try {
    const res = await apiFetch<{ conversations: Conversation[] }>('/api/conversations?limit=50');
    let convos = (res.conversations || []).sort((a, b) =>
      (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '')
    );
    if (agentFilter.value) convos = convos.filter(c => c.agentName === agentFilter.value);
    conversations.value = convos;
  } catch {}
}

watch(agentFilter, loadConversations);

async function openConversation(conv: Conversation) {
  activeConvId.value = conv.id;
  channelId.value = conv.channelId;
  selectedTurn.value = null;
  inspectTrace.value = null;

  const [msgRes, traceRes] = await Promise.all([
    apiFetch<{ messages: ChatMsg[] }>(`/api/conversations/${encodeURIComponent(conv.id)}/messages`),
    apiFetch<{ traces: Trace[] }>(`/api/conversations/${encodeURIComponent(conv.id)}/traces`),
  ]);
  messages.value = msgRes.messages || [];
  traces.value = traceRes.traces || [];
  buildTurns();
  await nextTick();
  scrollToBottom();
}

function buildTurns() {
  const result: Turn[] = [];
  let current: Turn | null = null;
  for (const msg of messages.value) {
    if (msg.role === 'user') {
      current = { index: result.length + 1, userMsg: msg, messages: [msg] };
      result.push(current);
    } else if (current) {
      current.messages.push(msg);
    }
  }
  // Link traces
  for (const turn of result) {
    turn.trace = traces.value.find(t => t.turnIndex === turn.index)
      || traces.value.find(t => t.input?.content === turn.userMsg.content);
  }
  turns.value = result;
}

function selectTurn(turn: Turn) {
  selectedTurn.value = turn;
  const trace = traces.value.find(t => t.turnIndex === turn.index)
    || traces.value.find(t => t.input?.content === turn.userMsg.content);
  inspectTrace.value = trace || null;
}

function closeInspect() {
  selectedTurn.value = null;
  inspectTrace.value = null;
}

function startNewChat() {
  if (!agentFilter.value && agents.value.length) agentFilter.value = agents.value[0].name;
  activeConvId.value = null;
  channelId.value = 'dashboard-' + Date.now();
  messages.value = [];
  traces.value = [];
  turns.value = [];
  selectedTurn.value = null;
  inspectTrace.value = null;
}

function sendMessage() {
  const text = inputText.value.trim();
  if (!text || streaming.value) return;
  const ch = channelId.value || ('dashboard-' + Date.now());
  channelId.value = ch;

  messages.value.push({ role: 'user', content: text, timestamp: new Date().toISOString() });
  streamText.value = '';
  streaming.value = true;
  buildTurns();

  props.ws.send({ type: 'message', channelId: ch, text });
  inputText.value = '';
  nextTick(scrollToBottom);
}

// WS message handler
let unsub: (() => void) | null = null;
onMounted(() => {
  unsub = props.ws.onMessage(handleWsMessage);
});
onUnmounted(() => { unsub?.(); });

function handleWsMessage(msg: WsMessage) {
  if (msg.type === 'approval_request') {
    approval.value = { toolName: msg.toolName as string, args: msg.args as Record<string, unknown> };
    feedbackMode.value = false;
    feedbackText.value = '';
    return;
  }

  if (msg.type === 'stream' && msg.text && streaming.value) {
    streamText.value += msg.text as string;
    nextTick(scrollToBottom);
    return;
  }

  if (msg.type === 'done' && streaming.value) {
    const reply = (msg.reply as string) || streamText.value;
    messages.value.push({ role: 'assistant', content: reply, timestamp: new Date().toISOString() });
    const toolResults = msg.toolResults as { name: string; durationMs: number; error?: string }[] | undefined;
    if (toolResults) {
      for (const tr of toolResults) {
        if (tr.name) {
          messages.value.push({ role: 'tool', name: tr.name, content: tr.error || `Completed in ${tr.durationMs}ms`, timestamp: new Date().toISOString() });
        }
      }
    }
    streaming.value = false;
    streamText.value = '';
    approval.value = null;
    buildTurns();
    nextTick(scrollToBottom);
    setTimeout(loadConversations, 500);
    return;
  }

  if (msg.type === 'error') {
    messages.value.push({ role: 'system', content: 'Error: ' + (msg.message || 'Unknown error') });
    streaming.value = false;
    streamText.value = '';
    approval.value = null;
    buildTurns();
    return;
  }

  if (msg.type === 'trace' && (msg.data as Trace)?.conversationId === activeConvId.value) {
    traces.value.push(msg.data as Trace);
    buildTurns();
  }
}

function respondApproval(approve: boolean) {
  props.ws.send({ type: 'approval_response', approve });
  approval.value = null;
}

function sendFeedback() {
  const text = feedbackText.value.trim();
  if (!text) return;
  props.ws.send({ type: 'approval_response', approve: false, feedback: text });
  approval.value = null;
  feedbackMode.value = false;
  feedbackText.value = '';
}

function scrollToBottom() {
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
}

function formatTime(ts?: string) {
  if (!ts) return '';
  try {
    const d = new Date(ts.includes('Z') || ts.includes('+') ? ts : ts + 'Z');
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}
</script>

<template>
  <div class="chat-layout">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <select v-model="agentFilter" class="w-full">
          <option value="">All agents</option>
          <option v-for="a in agents" :key="a.name" :value="a.name">{{ a.name }}</option>
        </select>
        <button class="btn btn-primary w-full" @click="startNewChat">New Chat</button>
      </div>
      <div class="sidebar-list">
        <div v-if="!conversations.length" class="empty" style="padding:20px;font-size:12px">No conversations</div>
        <div
          v-for="c in conversations" :key="c.id"
          :class="['conv-item', { active: c.id === activeConvId }]"
          @click="openConversation(c)"
        >
          <div class="conv-agent">{{ c.agentName }}</div>
          <div class="text-xs text-muted">{{ c.messageCount }} msgs</div>
          <div v-if="c.lastMessageExcerpt" class="conv-excerpt">{{ c.lastMessageExcerpt }}</div>
        </div>
      </div>
    </aside>

    <!-- Chat area -->
    <section class="chat-main">
      <div ref="messagesEl" class="messages">
        <div v-if="!turns.length && !streaming" class="empty">
          {{ activeConvId ? 'No messages yet' : 'Select a conversation or start a new chat' }}
        </div>

        <div
          v-for="turn in turns" :key="turn.index"
          :class="['turn-group', { selected: selectedTurn?.index === turn.index }]"
          @click="selectTurn(turn)"
        >
          <div v-for="(msg, i) in turn.messages" :key="i" :class="['msg', `msg-${msg.role}`]">
            <template v-if="msg.role === 'user'">{{ msg.content }}</template>
            <template v-else-if="msg.role === 'assistant'">{{ msg.content }}</template>
            <template v-else-if="msg.role === 'tool'">
              <strong>{{ msg.name || 'tool' }}</strong><br>
              {{ msg.content.length > 300 ? msg.content.slice(0, 300) + '...' : msg.content }}
            </template>
            <div v-if="msg.timestamp" class="msg-time">{{ formatTime(msg.timestamp) }}</div>
          </div>
          <div v-if="turn.trace" class="turn-meta">
            {{ (turn.trace.promptTokens || 0) + (turn.trace.completionTokens || 0) }} tok
            &middot; {{ turn.trace.durationMs }}ms
            <template v-if="turn.trace.toolCalls?.length">
              &middot; {{ turn.trace.toolCalls.length }} tool{{ turn.trace.toolCalls.length > 1 ? 's' : '' }}
            </template>
            &middot; {{ turn.trace.model }}
          </div>
        </div>

        <!-- Streaming bubble -->
        <div v-if="streaming && streamText" class="msg msg-assistant streaming-msg">
          {{ streamText }}
        </div>
      </div>

      <!-- Streaming indicator -->
      <div v-if="streaming && !approval" class="typing-indicator">Agent is typing...</div>

      <!-- Approval banner -->
      <div v-if="approval" class="approval-banner">
        <div class="approval-header">Tool approval required</div>
        <div class="approval-tool">{{ approval.toolName }}</div>
        <pre class="approval-args">{{ JSON.stringify(approval.args, null, 2) }}</pre>
        <div class="flex gap-2">
          <button class="btn btn-primary" @click="respondApproval(true)">Allow</button>
          <button class="btn btn-danger" @click="respondApproval(false)">Deny</button>
          <button class="btn" @click="feedbackMode = !feedbackMode">Feedback</button>
        </div>
        <div v-if="feedbackMode" class="flex gap-2 mt-2">
          <textarea v-model="feedbackText" placeholder="Tell the agent what to do instead..." class="flex-1" rows="2" style="resize:none;min-height:36px"></textarea>
          <button class="btn" @click="sendFeedback">Send</button>
        </div>
      </div>

      <!-- Input -->
      <div class="input-area">
        <textarea
          v-model="inputText"
          placeholder="Type a message..."
          rows="1"
          @keydown.enter.exact.prevent="sendMessage"
        ></textarea>
        <button class="btn btn-primary" :disabled="streaming || !inputText.trim()" @click="sendMessage">Send</button>
      </div>
    </section>

    <!-- Inspection panel -->
    <ChatInspect
      v-if="inspectTrace"
      :trace="inspectTrace"
      :turn-index="selectedTurn?.index"
      @close="closeInspect"
    />
  </div>
</template>

<style scoped>
.chat-layout { display: flex; height: calc(100vh - 88px); }

/* Sidebar */
.sidebar {
  flex: 0 0 260px;
  border-right: 1px solid var(--border);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
}
.sidebar-header {
  padding: 10px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sidebar-list { flex: 1; overflow-y: auto; }
.conv-item {
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-light);
  transition: background var(--transition);
}
.conv-item:hover { background: var(--bg-hover); }
.conv-item.active { background: var(--bg-active); border-left: 3px solid var(--accent-blue); }
.conv-agent { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.conv-excerpt {
  font-size: 12px; color: var(--text-faint); margin-top: 3px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Chat main */
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg-primary);
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Turn groups */
.turn-group {
  margin-bottom: 8px;
  padding: 4px;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: background var(--transition);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.turn-group:hover { background: rgba(22,27,34,0.4); }
.turn-group.selected { background: var(--bg-active); outline: 1px solid rgba(31,111,235,0.25); }
.turn-meta {
  font-size: 10px;
  color: var(--text-faint);
  padding: 0 4px;
}

/* Messages */
.msg {
  max-width: 85%;
  padding: 10px 14px;
  border-radius: var(--radius-xl);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-user {
  align-self: flex-end;
  background: #1f6feb;
  color: #fff;
  border-bottom-right-radius: var(--radius-sm);
}
.msg-assistant {
  align-self: flex-start;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-bottom-left-radius: var(--radius-sm);
}
.msg-tool {
  align-self: flex-start;
  background: var(--bg-tertiary);
  border-left: 3px solid var(--accent-yellow);
  font-size: 12px;
  color: var(--text-muted);
  max-width: 70%;
  border-radius: var(--radius-sm);
}
.msg-system {
  align-self: center;
  color: var(--text-faint);
  font-size: 11px;
  padding: 4px 8px;
}
.msg-time { font-size: 10px; color: var(--text-faint); margin-top: 3px; }
.msg-user .msg-time { color: rgba(255,255,255,0.45); }
.streaming-msg { opacity: 0.8; }

/* Typing indicator */
.typing-indicator {
  color: var(--accent-green);
  font-size: 12px;
  padding: 4px 20px;
}

/* Approval */
.approval-banner {
  background: var(--bg-tertiary);
  border: 1px solid var(--accent-yellow);
  border-radius: var(--radius-lg);
  margin: 8px 16px;
  padding: 14px 16px;
}
.approval-header { font-size: 12px; font-weight: 600; color: var(--accent-yellow); margin-bottom: 6px; }
.approval-tool { font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; }
.approval-args {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px;
  font-size: 11px;
  max-height: 200px;
  overflow: auto;
  margin-bottom: 10px;
}

/* Input */
.input-area {
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.input-area textarea {
  flex: 1;
  min-height: 38px;
  max-height: 120px;
  resize: none;
  line-height: 1.4;
  border-radius: var(--radius-lg);
}
</style>
