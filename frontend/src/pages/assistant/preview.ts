/** The development preview of /asistent (never in a production build). */
import { useEffect } from "react";

import { api } from "../../api";
import { NBSP } from "../../format";
import { CONNECTION_LOST, type NewItem } from "./session";

const NO_PREVIEW = { live: false, voice: false, error: null, since: null } as const;

/** How long the previewed session has lasted (its clock reads 3:12) and so when it began. */
export const PREVIEW_ELAPSED = 192_000;

const PREVIEW_SINCE = import.meta.env.DEV ? Date.now() - PREVIEW_ELAPSED : null;

const PREVIEW_ERRORS: Record<string, string> = {
  mikrofon: "Mikrofon nije dostupan. Dopustite pristup mikrofonu u pregledniku ili napišite pitanje.",
  veza: CONNECTION_LOST,
};

/**
 * Development preview of the booth without an agent: /asistent?pregled&uzivo (a live voice
 * conversation), &uzivo=tekst (a text one), ?greska=mikrofon|veza (an error notice). Nothing is
 * connected; the clock, the start in the byline and the voice level are fixed. Not part of
 * production builds.
 */
export function previewSession(): { live: boolean; voice: boolean; error: string | null; since: number | null } {
  if (!import.meta.env.DEV) return NO_PREVIEW;
  const params = new URLSearchParams(window.location.search);
  const error = PREVIEW_ERRORS[params.get("greska") ?? ""] ?? null;
  if (!params.has("uzivo")) return { ...NO_PREVIEW, error };
  return { live: true, voice: params.get("uzivo") !== "tekst", error, since: PREVIEW_SINCE };
}

/**
 * Development preview: /asistent?pregled&kartice=c_1,c_2&stanje=speaking shows saved cards in the
 * conversation without an agent (design review, screenshots); &razmislja adds a question that is
 * still waiting for its answer. Not part of production builds.
 */
export function usePreview(push: (item: NewItem) => void, setThinking: (thinking: boolean) => void) {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("pregled")) return;
    const cancel = new AbortController();
    const ids = (params.get("kartice") ?? "").split(",").filter(Boolean);
    void (async () => {
      for (const [i, id] of ids.entries()) {
        try {
          const card = await api.card(id);
          if (cancel.signal.aborted) return;
          push({ kind: "msg", role: "user", text: PREVIEW_QUESTIONS[i] ?? "A još?" });
          push({ kind: "msg", role: "agent", text: card.summary_hr });
          push({ kind: "card", card });
        } catch {
          // ignore missing preview cards
        }
      }
      if (cancel.signal.aborted) return;
      if (params.has("razmislja")) {
        push({ kind: "msg", role: "user", text: "A gdje je najbliži pedijatar?" });
        setThinking(true);
      } else if (ids.length && !params.has("uzivo")) {
        push({ kind: "note", text: `Razgovor je završen u${NBSP}10:42.` });
      }
    })();
    return () => {
      cancel.abort();
    };
  }, [push, setThinking]);
}

const PREVIEW_QUESTIONS = [
  "Gdje najprije mogu na MR koljena, blizu Vinkovaca?",
  "Je li Tomid na listi HZZO-a i kolika je doplata?",
  "Gdje je najbliža ambulanta u Osijeku?",
];
