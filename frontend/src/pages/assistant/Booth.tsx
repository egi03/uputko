/** The booth of /asistent: the microphone, the place line, an error notice and the clock. */
import { LocateFixed, Mic, X } from "lucide-react";
import { Fragment, type Ref, useEffect, useId, useRef, useState } from "react";

import { MoreLink } from "../../components/MoreLink";
import { duration, nbspHr } from "../../format";
import type { LocateFailure } from "../../hooks/useLocate";
import type { Place } from "./session";

/**
 * The microphone: a round button that starts a voice conversation. Its visible label sits beside
 * it on the page; the button carries the whole name.
 */
export function TalkButton({ busy, onClick, ref }: { busy: boolean; onClick: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      className="mic btn--talk"
      onClick={onClick}
      disabled={busy}
      aria-label={busy ? "Spajanje…" : "Razgovaraj glasom: pritisnite i recite pitanje"}
    >
      <Mic aria-hidden="true" />
    </button>
  );
}

/** What „Koristi moju lokaciju” says when it finds no place; the place can still be asked for. */
const PLACE_FAILURE: Record<LocateFailure, string> = {
  denied: "Lokacija nije dopuštena.",
  unavailable: "Lokacija trenutno nije dostupna.",
  unsupported: "Preglednik ne podržava lokaciju.",
  not_found: "Mjesto nije pronađeno.",
};

/**
 * „Koristi moju lokaciju”, or the place it found with a way to drop it. When no place is found,
 * a run-in under the button says why and how to name the place instead: this page has no place
 * field, the question itself carries it. One status line stays in the page either way: it says
 * why no place was found, or (for screen readers; the line above shows it) which place was just
 * found.
 */
export function PlaceLine({
  place,
  locating,
  disabled,
  failure,
  onLocate,
  onClear,
  className,
}: {
  place: Place | null;
  locating: boolean;
  disabled: boolean;
  failure: { reason: LocateFailure; message: string } | null;
  onLocate: () => void;
  onClear: () => void;
  className: string;
}) {
  const locateButton = useRef<HTMLButtonElement>(null);
  const clearButton = useRef<HTMLButtonElement>(null);
  const cleared = useRef(false);
  const located = useRef(false);
  const noteId = useId();
  // A place found here is said once; one this line already had when it appeared is not.
  const [found, setFound] = useState<string | null>(null);
  const [known, setKnown] = useState(place);
  if (place !== known) {
    setKnown(place);
    setFound(place && !known ? place.name : null);
  }
  // „Koristi moju lokaciju” gives way to the place it found, and „Ukloni lokaciju” to the button
  // again: a focus that went with either goes on to the other.
  useEffect(() => {
    if (place) {
      if (!located.current) return;
      located.current = false;
      const active = document.activeElement;
      if (!active || active === document.body) clearButton.current?.focus();
      return;
    }
    if (!cleared.current) return;
    cleared.current = false;
    locateButton.current?.focus();
  }, [place]);
  const lead =
    !place && failure ? (failure.reason === "not_found" ? failure.message : PLACE_FAILURE[failure.reason]) : null;
  return (
    <>
      {place ? (
        <p className={`place-line ${className}`}>
          <LocateFixed aria-hidden="true" />
          <span>
            Vaše mjesto: <b>{place.name}</b>
          </span>
          <button
            ref={clearButton}
            type="button"
            className="btn btn--icon place-line__x"
            aria-label="Ukloni lokaciju"
            onClick={() => {
              cleared.current = true;
              onClear();
            }}
          >
            <X aria-hidden="true" />
          </button>
        </p>
      ) : (
        // While it looks, the button only says so (aria-disabled): a disabled button would drop
        // the keyboard's focus. In a conversation the place is fixed, so it is disabled.
        <button
          ref={locateButton}
          type="button"
          className={`linkbtn ${className}`}
          onClick={
            locating
              ? undefined
              : () => {
                  located.current = true;
                  onLocate();
                }
          }
          disabled={disabled}
          aria-disabled={locating || undefined}
          aria-describedby={lead ? noteId : undefined}
        >
          <LocateFixed aria-hidden="true" />
          <span>{locating ? "Traženje mjesta…" : "Koristi moju lokaciju"}</span>
        </button>
      )}
      {/* In the page from the start, so what it says once a lookup ends is announced. */}
      <p className={lead || !found ? "runin place-note" : "visually-hidden"} id={noteId} role="status">
        {lead ? (
          <>
            <b>{nbspHr(lead)}</b> Mjesto recite ili napišite u&nbsp;pitanju, npr. „Gdje je ambulanta
            u&nbsp;Vinkovcima?”
          </>
        ) : found ? (
          `Mjesto postavljeno: ${found}.`
        ) : null}
      </p>
    </>
  );
}

/**
 * An error as a run-in notice: the first sentence is the label, then what still works without
 * the conversation.
 */
export function ErrorNote({ message, onDismiss, className }: { message: string; onDismiss: () => void; className: string }) {
  const [lead, rest] = splitLead(nbspHr(message));
  return (
    <div className={`runin runin--alert ${className}`} role="alert">
      <p>
        <b>{lead}</b>
        {rest ? ` ${rest}` : ""}
      </p>
      <p>Liste čekanja i&nbsp;lijekovi rade i&nbsp;bez razgovora.</p>
      <p className="runin__acts">
        <MoreLink to="/termini">Liste čekanja</MoreLink>
        <MoreLink to="/lijekovi">Lijekovi</MoreLink>
        <button type="button" className="btn btn--sm" onClick={onDismiss}>
          U&nbsp;redu
        </button>
      </p>
    </div>
  );
}

/** "Mikrofon nije dostupan. Dopustite …" -> ["Mikrofon nije dostupan.", "Dopustite …"]. */
function splitLead(message: string): [string, string] {
  const match = /^([^(]+?[.!?])\s+(\S[\s\S]*)$/.exec(message);
  return match ? [match[1] ?? message, match[2] ?? ""] : [message, ""];
}

/**
 * The booth's clock: how long the open session has lasted, read again every second. Only this
 * element renders each second, not the transcript around it.
 */
export function Clock({ since, fixed }: { since: number | null; fixed: number | null }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (since === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  const elapsed = fixed ?? (since === null ? 0 : now - since);
  // Tabular digits, so the clock does not jitter; the colon keeps its own narrow width.
  const [head, ...rest] = duration(elapsed).split(":");
  return (
    <b className="num clock">
      {head}
      {rest.map((part, i) => (
        <Fragment key={i}>
          <span className="clock__sep">:</span>
          {part}
        </Fragment>
      ))}
    </b>
  );
}
