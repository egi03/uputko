/**
 * What a conversation with the assistant is made of: its items, the place, the transport, the
 * indicator's state and its caption.
 */
import { NBSP } from "../../format";
import type { Card } from "../../types";

export type Item =
  | { kind: "msg"; id: number; role: "user" | "agent"; text: string }
  | { kind: "card"; id: number; card: Card }
  | { kind: "note"; id: number; text: string };

export type NewItem =
  | { kind: "msg"; role: "user" | "agent"; text: string }
  | { kind: "card"; card: Card }
  | { kind: "note"; text: string };

export interface Place {
  name: string;
  county: string;
}

export type Transport = "webrtc" | "websocket";

/** The session's own state, from the SDK's status changes (errors leave it as it is). */
export type SessionStatus = "disconnected" | "connecting" | "connected";

/** What the voice indicator shows (styles/assistant.css, .voice[data-state]). */
export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

/** A dropped connection, whatever the SDK called it (its message goes to the console). */
export const CONNECTION_LOST = "Veza s asistentom je prekinuta. Pokušajte ponovno za trenutak ili napišite pitanje.";

/** No session has been connected on this page yet (a start that failed, or none). */
const NOT_STARTED = "Razgovor nije počeo.";

/**
 * The status line: what is happening now, and what one can do. `started`: a session has been
 * connected on this page, so with none open there is one that ended, not one that never began.
 * A voice start that fails during a text conversation leaves that conversation open (`live`).
 */
export function captionFor({
  state,
  busy,
  live,
  voice,
  active,
  started,
}: {
  state: VoiceState;
  busy: boolean;
  live: boolean;
  voice: boolean;
  active: boolean;
  started: boolean;
}): string {
  if (state === "error" && !live) return started ? `Razgovor nije u${NBSP}tijeku.` : NOT_STARTED;
  if (busy) return "Spajanje…";
  if (state === "speaking") return "Asistent govori. Možete ga prekinuti.";
  if (state === "thinking") return "Traženje podataka…";
  if (state === "listening" || voice) return "Govorite.";
  if (live) return "Napišite pitanje.";
  if (active) return started ? "Razgovor je završen." : NOT_STARTED;
  return `Pritisnite mikrofon i${NBSP}postavite pitanje.`;
}
