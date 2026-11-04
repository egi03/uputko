import { useEffect } from "react";

import { cardStreamUrl } from "../api";
import type { Card } from "../types";

const FIRST_RETRY_MS = 1_000;
const LAST_RETRY_MS = 30_000;

/**
 * Cards for a conversation via SSE. The browser reconnects a dropped stream by
 * itself, but gives up for good after an HTTP error (a 502 while the backend restarts, a 429):
 * then a new stream opens a little later. Every stream starts with all of the conversation's
 * cards, and `onCard` keeps each card once.
 */
export function useCardStream(conversationId: string | null, onCard: (card: Card) => void) {
  useEffect(() => {
    if (!conversationId) return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = FIRST_RETRY_MS;
    const handler = (event: MessageEvent<string>) => {
      try {
        onCard(JSON.parse(event.data) as Card);
      } catch {
        // ignore malformed events
      }
    };
    const open = () => {
      const stream = new EventSource(cardStreamUrl(conversationId));
      source = stream;
      stream.addEventListener("card", handler);
      stream.addEventListener("open", () => {
        delay = FIRST_RETRY_MS;
      });
      stream.addEventListener("error", () => {
        if (stream.readyState !== EventSource.CLOSED) return; // the browser is reconnecting
        retry = setTimeout(open, delay);
        delay = Math.min(delay * 2, LAST_RETRY_MS);
      });
    };
    open();
    return () => {
      clearTimeout(retry);
      source?.close();
    };
  }, [conversationId, onCard]);
}
