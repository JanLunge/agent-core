import { ref, type Ref } from 'vue';

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

export interface WebSocketState {
  connected: Ref<boolean>;
  send: (msg: WsMessage) => void;
  close: () => void;
  onMessage: (handler: (msg: WsMessage) => void) => () => void;
}

export function useWebSocket(): WebSocketState {
  const connected = ref(false);
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const handlers = new Set<(msg: WsMessage) => void>();

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${proto}//${location.host}/ws`);

    socket.onopen = () => { connected.value = true; };

    socket.onclose = () => {
      connected.value = false;
      socket = null;
      reconnectTimer = setTimeout(connect, 3000);
    };

    socket.onerror = () => { /* onclose will fire */ };

    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as WsMessage;
        for (const handler of handlers) handler(msg);
      } catch { /* ignore malformed */ }
    };
  }

  connect();

  function send(msg: WsMessage) {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  function close() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close();
  }

  function onMessage(handler: (msg: WsMessage) => void): () => void {
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  return { connected, send, close, onMessage };
}
