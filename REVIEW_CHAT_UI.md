# Chat Interface Review & Improvement Plan

## Current Architecture Overview

The chat interface is built with:
- **React + TanStack Router** – file-based routing with code splitting
- **TanStack Query** – server state management with caching
- **Zustand** – client-side state (chat store, session model store, workspace store)
- **SSE (Server-Sent Events)** – real-time streaming via `useRealtimeChatHistory`
- **Optimistic updates** – messages appear immediately, reconciled with server

Key files:
| File | Lines | Purpose |
|------|-------|---------|
| `src/screens/chat/chat-screen.tsx` | ~2972 | Main chat component |
| `src/screens/chat/chat-queries.ts` | ~603 | Data fetching, dedup, optimistic merge |
| `src/screens/chat/hooks/use-chat-history.ts` | ~723 | History management hook |
| `src/screens/chat/hooks/use-realtime-chat-history.ts` | ~450 | SSE streaming hook |
| `src/screens/chat/hooks/use-chat-sessions.ts` | ~200 | Session management |
| `src/hooks/use-chat-mode.ts` | ~30 | Mode detection (enhanced/portable/disconnected) |
| `src/server/gateway-capabilities.ts` | ~961 | Gateway probing & capability detection |
| `src/stores/chat-store.ts` | ~300 | Zustand chat state |

---

## Issues Found

### 1. Performance Issues

#### 1.1 Excessive Re-renders
**Problem**: `chat-screen.tsx` is a 2972-line monolithic component with dozens of `useState`, `useRef`, and `useMemo` hooks. Every state change triggers a re-render of the entire tree.

**Impact**: Typing in the composer, streaming responses, and tool calls all cause full component re-renders.

**Fix**: Split into smaller sub-components:
- `ChatHeader` (already exists)
- `ChatMessageList` (already exists)
- `ChatComposer` (already exists)
- `ChatStreamingIndicator` (new)
- `ChatToolActivity` (new)
- `ChatApprovalBanner` (new)

#### 1.2 History Refetch Too Aggressive
**Problem** (line 400-406 in `use-chat-history.ts`):
```typescript
refetchOnMount: 'always',
refetchOnWindowFocus: true,
refetchInterval: historyRefetchInterval, // 5s or 30s
staleTime: 0, // Always refetch on mount
```

This means:
- Every time the user switches tabs and comes back, history is refetched
- Every 5s (when SSE disconnected) or 30s (when connected), the full history is re-fetched
- `staleTime: 0` means data is always considered stale

**Impact**: Unnecessary network requests, potential for flash-of-old-data, wasted bandwidth.

**Fix**:
```typescript
refetchOnMount: 'always',
refetchOnWindowFocus: false, // Don't refetch on tab switch if SSE is connected
refetchInterval: isRealtimeStreaming ? false : historyRefetchInterval,
staleTime: 10_000, // 10s stale time reduces unnecessary refetches
```

#### 1.3 Dedup Logic is O(n²)
**Problem** (`replaceMatchingOptimisticUserMessage`, `appendHistoryMessage`): For every incoming message, the code iterates through all existing messages to find duplicates. With 1000+ message histories, this becomes expensive.

**Impact**: Lag when receiving messages in long conversations.

**Fix**: Use a `Map<string, ChatMessage>` for O(1) lookups by clientId:
```typescript
// In use-chat-history.ts
const clientIdIndexRef = useRef<Map<string, number>>(new Map());

// Update index when messages change
useEffect(() => {
  const map = new Map<string, number>();
  rawHistoryMessages.forEach((msg, idx) => {
    const cid = getMessageClientId(msg);
    if (cid) map.set(cid, idx);
  });
  clientIdIndexRef.current = map;
}, [rawHistoryMessages]);

// O(1) lookup instead of O(n) search
function findMessageByClientId(clientId: string): ChatMessage | undefined {
  const idx = clientIdIndexRef.current.get(clientId);
  return idx !== undefined ? rawHistoryMessages[idx] : undefined;
}
```

#### 1.4 Large Message Payloads
**Problem**: `fetchHistory` requests up to 1000 messages with full content:
```typescript
const query = new URLSearchParams({ limit: '1000' });
```

**Impact**: Large network payloads, slow initial load for long conversations.

**Fix**: Implement virtual scrolling with windowed fetching:
```typescript
// Fetch only visible messages + buffer
const query = new URLSearchParams({
  limit: '50',
  offset: `${Math.max(0, scrollPosition - 25)}`
});
```

#### 1.5 No Virtualization for Message List
**Problem**: All messages are rendered in the DOM simultaneously. A conversation with 500+ messages creates 500+ DOM nodes.

**Impact**: Slow scrolling, high memory usage, jank on mobile.

**Fix**: Use `@tanstack/react-virtual` for windowed rendering:
```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function ChatMessageList({ messages }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // estimated message height
    overscan: 5,
  });

  return (
    <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(item => (
          <div
            key={item.key}
            style={{
              position: 'absolute',
              top: item.start,
              width: '100%',
            }}
          >
            <ChatMessage message={messages[item.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

### 2. Functional Issues

#### 2.1 Mode Detection Latency
**Problem** (`use-chat-mode.ts`): Gateway status is polled every 60 seconds. If the gateway restarts, the UI won't detect the change for up to 60s.

**Impact**: User may see "disconnected" even though the gateway is back, or vice versa.

**Fix**: Add exponential backoff retry on failure:
```typescript
refetchInterval: data?.capabilities?.health
  ? 60_000  // Healthy: check every 60s
  : 5_000,  // Unhealthy: check every 5s
```

#### 2.2 No Retry on Transient Network Errors
**Problem**: If a single history fetch fails, the UI shows an error but doesn't automatically retry.

**Callback**: Add retry logic:
```typescript
retry: (failureCount, error) => {
  if (error instanceof NetworkError) return failureCount < 3;
  return false; // Don't retry auth errors
},
retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
```

#### 2.3 Streaming Text Performance
**Problem**: `useSmoothStreamingText` likely updates state on every token chunk, causing re-renders for each character.

**Fix**: Batch updates using `requestAnimationFrame`:
```typescript
useEffect(() => {
  let rafId: number;
  let pendingText = '';
  
  const processChunk = () => {
    if (pendingText) {
      setDisplayText(prev => prev + pendingText);
      pendingText = '';
    }
  };

  // Instead of setting state per token:
  pendingText += chunk;
  if (!rafId) {
    rafId = requestAnimationFrame(() => {
      processChunk();
      rafId = 0;
    });
  }

  return () => { if (rafId) cancelAnimationFrame(rafId); };
}, [streamingText]);
```

#### 2.4 No Message Search
**Problem**: No way to search through conversation history. Users must scroll manually.

**Fix**: Add a search bar that filters messages:
```typescript
const [searchQuery, setSearchQuery] = useState('');
const filteredMessages = useMemo(() => {
  if (!searchQuery) return messages;
  const q = searchQuery.toLowerCase();
  return messages.filter(m => textFromMessage(m).toLowerCase().includes(q));
}, [messages, searchQuery]);
```

#### 2.5 No Message Copy/Share
**Problem**: Users can't easily copy message text or share a link to a specific message.

**Fix**: Add a context menu or hover actions to each message:
```tsx
<div className="message-actions opacity-0 group-hover:opacity-100 transition-opacity">
  <button onClick={() => navigator.clipboard.writeText(text)}>
    Copy
  </button>
  <button onClick={() => shareMessage(messageId)}>
    Share
  </button>
</div>
```

---

### 3. UX Improvements

#### 3.1 Keyboard Shortcuts
Add common shortcuts:
| Key | Action |
|-----|--------|
| `Ctrl/Cmd + K` | Focus search |
| `Ctrl/Cmd + N` | New chat |
| `Ctrl/Cmd + Shift + C` | Copy last assistant message |
| `Escape` | Stop generation |
| `Arrow Up` | Edit last message (when composer empty) |

#### 3.2 Typing Indicators
Show when the assistant is actively streaming:
```tsx
{isStreaming && (
  <div className="typing-indicator">
    <span className="dot" />
    <span className="dot" />
    <span className="dot" />
  </div>
)}
```

#### 3.3 Message Grouping
Group consecutive messages from the same sender to reduce visual clutter:
```tsx
// Instead of individual bubbles for each message:
<MessageGroup
  role="assistant"
  messages={groupedMessages}
  timestamp={groupedMessages[0].timestamp}
/>
```

#### 3.4 Better Error States
Replace generic "Failed to load" with actionable messages:
```tsx
{historyError && (
  <div className="error-state">
    <p>{getFriendlyErrorMessage(historyError)}</p>
    <button onClick={() => refetch()}>Retry</button>
    <button onClick={() => navigateToNewChat()}>Start New Chat</button>
  </div>
)}
```

#### 3.5 Conversation Export
Add export options (Markdown, JSON, PDF):
```typescript
function exportConversation(format: 'md' | 'json' | 'pdf') {
  const content = messages.map(m => `**${m.role}**: ${textFromMessage(m)}`).join('\n\n');
  downloadFile(content, `conversation.${format}`);
}
```

---

### 4. Code Quality Improvements

#### 4.1 Split chat-screen.tsx
The 2972-line file should be split:
```
src/screens/chat/
├── chat-screen.tsx          # Main layout only (~200 lines)
├── chat-header.tsx          # Header with title, actions
├── chat-message-list.tsx    # Virtualized message list
├── chat-message-group.tsx   # Grouped messages
├── chat-composer.tsx        # Input area
├── chat-streaming.tsx       # Streaming indicator
├── chat-tool-activity.tsx   # Tool call display
├── chat-approval-banner.tsx # Approval requests
├── chat-error-state.tsx     # Error display
└── chat-empty-state.tsx     # Empty state
```

#### 4.2 Extract Custom Hooks
Move complex logic out of components:
```typescript
// hooks/use-chat-connection.ts
export function useChatConnection() {
  const { data: gatewayStatus } = useGatewayStatus();
  const mode = useChatMode();
  const isConnected = gatewayStatus?.capabilities?.health ?? false;
  return { mode, isConnected, gatewayStatus };
}

// hooks/use-chat-export.ts
export function useChatExport(messages: ChatMessage[]) {
  const exportAsMarkdown = useCallback(() => { /* ... */ }, [messages]);
  const exportAsJson = useCallback(() => { /* ... */ }, [messages]);
  return { exportAsMarkdown, exportAsJson };
}
```

#### 4.3 Add Error Boundaries
Prevent full crash on component errors:
```tsx
<ErrorBoundary fallback={<ChatErrorFallback />}>
  <ChatScreen />
</ErrorBoundary>
```

#### 4.4 TypeScript Strictness
Enable stricter checks:
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

---

## Priority Implementation Order

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| P0 | Virtual scrolling for messages | Medium | High |
| P0 | Reduce history refetch frequency | Low | High |
| P1 | Split chat-screen.tsx | High | Medium |
| P1 | O(1) dedup with Map index | Low | Medium |
| P1 | Streaming text batching | Low | Medium |
| P2 | Keyboard shortcuts | Medium | Medium |
| P2 | Message search | Medium | Medium |
| P2 | Copy/share messages | Low | Low |
| P3 | Conversation export | Medium | Low |
| P3 | Message grouping | Medium | Low |
| P3 | Error boundaries | Low | Medium |

---

*Review based on static code analysis of the Hermes Workspace UI codebase.*
*Files examined: chat-screen.tsx, chat-queries.ts, use-chat-history.ts, use-chat-mode.ts, gateway-capabilities.ts, task-store.ts*