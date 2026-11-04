import { ConversationProvider, useConversationControls, useConversationMode } from "@elevenlabs/react";
import { AudioLines, Mic, PhoneOff, RotateCw, SendHorizontal } from "lucide-react";
import { type Ref, type SubmitEvent, useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, useLocation, useNavigate } from "react-router-dom";

import { api, ApiError } from "../api";
import { ExtLink } from "../components/ExtLink";
import { duration, NBSP, timeHr } from "../format";
import { useCardStream } from "../hooks/useCardStream";
import { useHeightVar } from "../hooks/useHeightVar";
import { type LocateFailure, useLocate } from "../hooks/useLocate";
import { useTitle } from "../hooks/useTitle";
import { useReducedMotion } from "../prefs";
import type { Card } from "../types";
import { Clock, ErrorNote, PlaceLine, TalkButton } from "./assistant/Booth";
import { PREVIEW_ELAPSED, previewSession, usePreview } from "./assistant/preview";
import {
  captionFor,
  CONNECTION_LOST,
  type Item,
  type NewItem,
  type Place,
  type SessionStatus,
  type Transport,
  type VoiceState,
} from "./assistant/session";
import { Byline, type Opening, Sources, Turns } from "./assistant/Transcript";
import { useVoiceLevel } from "./assistant/useVoiceLevel";

/** What the front page hands over (Home.tsx): the focus goes to the microphone. */
interface Handoff {
  focus?: "mic";
}

export function AssistantPage() {
  useTitle("AI asistent");
  const [items, setItems] = useState<Item[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When the open session began (the booth's clock) and when the first one did (the byline).
  const [since, setSince] = useState<number | null>(null);
  const [firstSince, setFirstSince] = useState<number | null>(null);
  const nextId = useRef(0);
  // Typed questions show at once, so the server's echo of each is skipped. Several can wait for
  // theirs: questions typed while the text session connects are sent together.
  const typedEchoes = useRef<string[]>([]);
  const live = useRef(false);
  const startedAt = useRef<number | null>(null);
  const voiceSession = useRef(false);

  const push = useCallback((item: NewItem) => {
    setItems((prev) => {
      if (item.kind === "card" && prev.some((i) => i.kind === "card" && i.card.card_id === item.card.card_id)) {
        return prev;
      }
      return [...prev, { ...item, id: nextId.current++ }];
    });
  }, []);
  const onCard = useCallback((card: Card) => push({ kind: "card", card }), [push]);
  // The session's own state. The SDK's useConversationStatus() reports every error as "error",
  // also one the session goes on after (a server notice): read as the state of the connection,
  // a conversation still open would stop sending questions and could be left without a question.
  const [session, setSession] = useState<SessionStatus>("disconnected");
  const stopThinking = useCallback(() => setThinking(false), []);
  // An error ends the wait for an answer: no typing dots left running.
  const fail = useCallback((message: string | null) => {
    setError(message);
    if (message) setThinking(false);
  }, []);
  // How many sessions have connected: a question asked while none was connected counts as sent
  // once the next one connects (Conversation, `queued`).
  const [connects, setConnects] = useState(0);
  // The end of a session. The transcript and cards stay; a line says when the conversation itself
  // ended and, for a voice conversation, how long it lasted. „Nastavi glasom” ends a text session
  // this way too, right before the voice one starts (the SDK then drops the old session's events).
  const close = useCallback(
    (failed: boolean) => {
      setConversationId(null);
      setThinking(false);
      if (failed) fail(CONNECTION_LOST);
      if (live.current) {
        const time = timeHr();
        const lasted =
          voiceSession.current && startedAt.current !== null
            ? `${NBSP}· trajao${NBSP}${duration(Date.now() - startedAt.current)}`
            : "";
        push({ kind: "note", text: `Razgovor je završen u${NBSP}${time}${lasted}.` });
      }
      live.current = false;
      startedAt.current = null;
      setSince(null);
    },
    [fail, push],
  );

  useCardStream(conversationId, onCard);
  usePreview(push, setThinking);

  return (
    <ConversationProvider
      onStatusChange={({ status }) => setSession(status === "disconnecting" ? "disconnected" : status)}
      onConnect={({ conversationId: id }) => {
        setConversationId(id);
        setError(null);
        setConnects((n) => n + 1);
        live.current = true;
        const now = Date.now();
        startedAt.current = now;
        setSince(now);
        setFirstSince((first) => first ?? now);
      }}
      onDisconnect={(details) => close(details.reason === "error")}
      onMessage={({ role, message }) => {
        if (!message.trim()) return;
        if (role === "user") {
          const echo = typedEchoes.current.indexOf(message);
          if (echo >= 0) {
            typedEchoes.current.splice(echo, 1);
            return; // typed text is shown already
          }
          setThinking(true);
          push({ kind: "msg", role: "user", text: message });
        } else {
          setThinking(false);
          push({ kind: "msg", role: "agent", text: message });
        }
      }}
      onError={(message) => {
        // The SDK's own words are English and technical: they go to the console, the page says
        // what happened in Croatian. It reports errors the session goes on after (a server notice,
        // a microphone switch) as well: during a conversation the connection is lost only when
        // the session ends with an error (onDisconnect).
        console.warn("ElevenLabs:", message);
        if (!live.current) fail(CONNECTION_LOST);
      }}
    >
      <Conversation
        session={session}
        items={items}
        thinking={thinking}
        error={error}
        setError={fail}
        since={since}
        firstSince={firstSince}
        connects={connects}
        onTransport={(kind) => {
          voiceSession.current = kind === "webrtc";
        }}
        onUserText={(text) => {
          typedEchoes.current = [...typedEchoes.current, text].slice(-10);
          setThinking(true);
          push({ kind: "msg", role: "user", text });
        }}
        // Questions already on screen go out again: their echoes are still awaited, the dots too.
        onResend={() => setThinking(true)}
        onSessionEnd={() => close(false)}
        onAgentSpeaking={stopThinking}
      />
    </ConversationProvider>
  );
}

/** The quiet first line in the transcript before the greeting arrives. */
const OPENING_HINT = "Pitajte za termin, ambulantu ili lijek.";

/** Under the talk button, before and during the conversation (the byline promises the same). */
/** Before a conversation: the microphone, who processes it and what starting it agrees to. */
function MicHint({ className }: { className: string }) {
  return (
    <p className={`small ${className}`}>
      Razgovor obrađuju ElevenLabs i{NBSP}jezični model; glas se ne snima. Ne navodite osobne podatke. Pokretanjem razgovora
      ili slanjem pitanja pristajete na <ExtLink href="/privatnost">obradu podataka</ExtLink>.
    </p>
  );
}

/** The microphone during a text conversation: it goes on as a voice one. */
const VOICE_ON = "Nastavi glasom";

/** Questions one can ask with one press, before the first conversation. */
const EXAMPLES = ["MR koljena u Osijeku", "Najbliži pedijatar u Zadru", "Je li Tomid na listi HZZO-a?"];

function errorMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 503) {
    return "Asistent trenutno nije dostupan. Pokušajte malo kasnije.";
  }
  return e instanceof ApiError ? e.message : "Razgovor trenutno nije moguće pokrenuti.";
}

function Conversation({
  session,
  items,
  thinking,
  error,
  setError,
  since,
  firstSince,
  connects,
  onTransport,
  onUserText,
  onResend,
  onSessionEnd,
  onAgentSpeaking,
}: {
  session: SessionStatus;
  items: Item[];
  thinking: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  since: number | null;
  firstSince: number | null;
  connects: number;
  onTransport: (kind: Transport) => void;
  onUserText: (text: string) => void;
  onResend: () => void;
  onSessionEnd: () => void;
  onAgentSpeaking: () => void;
}) {
  const controls = useConversationControls();
  const { startSession, endSession, sendUserMessage, sendUserActivity } = controls;
  const { isSpeaking } = useConversationMode();
  const reduced = useReducedMotion();
  const [place, setPlace] = useState<Place | null>(null);
  // Why „Koristi moju lokaciju” found no place: a note under the button, not a conversation error
  // (nothing is broken, and the voice indicator stays as it is).
  const [placeFailure, setPlaceFailure] = useState<{ reason: LocateFailure; message: string } | null>(null);
  const { locate, locating } = useLocate(
    (found) => {
      setPlace(found);
      setPlaceFailure(null);
    },
    (message, reason) => setPlaceFailure({ reason, message }),
  );
  const [text, setText] = useState("");
  const [transport, setTransport] = useState<Transport | null>(null);
  const [starting, setStarting] = useState(false);
  // The questions the next session sends once it is connected.
  const pending = useRef<string[]>([]);
  // Questions asked while no session was connected, each with the count of connections then: it
  // was sent once a session has connected since. Until then it waits, and after a failed start it
  // stays on screen with „Pošalji ponovno”.
  const [queued, setQueued] = useState<{ text: string; round: number }[]>([]);
  // The voice indicator and the booth are other elements before the conversation than in it, so
  // the effects that drive them follow the elements themselves (state, not refs).
  const [indicator, setIndicator] = useState<HTMLDivElement | null>(null);
  const [booth, setBooth] = useState<HTMLElement | null>(null);
  const [composerForm, setComposerForm] = useState<HTMLFormElement | null>(null);
  // The list of messages scrolls on its own; the page around it stays still.
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const field = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const refocus = useRef<"field" | "heading" | null>(null);
  const talkButton = useRef<HTMLButtonElement>(null);
  const endButton = useRef<HTMLButtonElement>(null);
  const voiceOnButton = useRef<HTMLButtonElement>(null);
  const resendButton = useRef<HTMLButtonElement>(null);
  // „Razgovaraj” or „Nastavi glasom” was pressed (the focus goes on to „Završi razgovor” once the
  // voice is connected), „Završi razgovor” was pressed (the focus comes back to „Razgovaraj” when
  // the session is over).
  const talkPressed = useRef(false);
  const endPressed = useRef(false);
  // „Nastavi glasom” is on its way; „Završi razgovor” meanwhile calls it off.
  const switching = useRef(false);
  const preview = previewSession();
  const location = useLocation();
  const navigate = useNavigate();
  const handoff = useRef<Handoff | null>((location.state as Handoff | null) ?? null);

  const connected = session === "connected";
  const busy = starting || session === "connecting";
  const voice = connected && transport === "webrtc";
  const phase = items.length || connected || busy || preview.live ? "active" : "welcome";
  // What a failed start left unsent (the next start sends it first).
  const unsent = connected || busy ? [] : queued.filter((q) => q.round === connects).map((q) => q.text);
  // A session was connected here: with none open now, one has ended (not one that never began).
  const started = firstSince !== null || items.some((i) => i.kind === "note");

  // In development a preview may show an error without any session (?greska=mikrofon|veza).
  const failure = error ?? preview.error;
  let state: VoiceState = "idle";
  if (failure) state = "error";
  else if (busy) state = "thinking";
  else if (connected && isSpeaking) state = "speaking";
  else if (thinking) state = "thinking";
  else if (voice) state = "listening";
  if (import.meta.env.DEV) {
    const forced = new URLSearchParams(window.location.search).get("stanje");
    if (forced) state = forced as VoiceState;
  }

  useEffect(() => {
    if (isSpeaking) onAgentSpeaking();
  }, [isSpeaking, onAgentSpeaking]);
  // Another page ends the conversation: a link, the back and forward buttons and a phone's back
  // gesture ask first (the same page with another query or section does not).
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => connected && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("Razgovor s asistentom će se završiti. Otvoriti drugu stranicu?")) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!connected) return;
    // Closing or reloading the tab ends the conversation too: the browser asks first.
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [connected]);

  // Send the questions typed before the text session was connected.
  useEffect(() => {
    if (connected) for (const question of pending.current.splice(0)) sendUserMessage(question);
  }, [connected, sendUserMessage]);
  useEffect(() => {
    if (error) pending.current = [];
  }, [error]);

  useVoiceLevel(indicator, booth, { voice, isSpeaking, reduced, controls, previewVoice: preview.voice });

  // A new message scrolls the list (never the window) to its end. While the reader stays at the
  // end, an answer that grows as it arrives keeps the end in view; scrolled up, they stay put.
  useEffect(() => {
    const box = scroller.current;
    if (!box || !(items.length || thinking)) return;
    atBottom.current = true;
    box.scrollTo({ top: box.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [items.length, thinking, reduced]);
  useEffect(() => {
    const box = scroller.current;
    const list = box?.firstElementChild;
    if (!box || !list) return;
    const onScroll = () => {
      atBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
    };
    const grown = new ResizeObserver(() => {
      if (atBottom.current) box.scrollTop = box.scrollHeight;
    });
    box.addEventListener("scroll", onScroll, { passive: true });
    grown.observe(list);
    return () => {
      box.removeEventListener("scroll", onScroll);
      grown.disconnect();
    };
  }, [phase]);
  // The conversation fills the window below the top bar: it starts at the top of the page.
  useEffect(() => {
    if (phase === "active") window.scrollTo({ top: 0, behavior: "instant" });
  }, [phase]);

  // A question asked before the first conversation swaps the intro for the conversation: focus
  // follows to the conversation's own field (a typed question) or to its headline (a button).
  useEffect(() => {
    if (phase !== "active" || !refocus.current) return;
    (refocus.current === "field" ? field.current : heading.current)?.focus({ preventScroll: true });
    refocus.current = null;
  }, [phase]);

  // The talk button is gone once the voice conversation is connected: a focus it left behind (on
  // the page, or on the headline it was led to) goes on to „Završi razgovor”. Ending works the
  // other way round, so a keyboard never has to start again from the top of the page.
  useEffect(() => {
    if (!voice || !talkPressed.current) return;
    talkPressed.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || active === heading.current) endButton.current?.focus();
  }, [voice]);
  // A voice conversation that did not start (no microphone, no connection) leaves the focus on
  // „Razgovaraj” again (or on „Nastavi glasom”, while the text conversation goes on), with the
  // notice that says why right under it.
  useEffect(() => {
    if (!error || !talkPressed.current) return;
    talkPressed.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || active === heading.current) {
      (talkButton.current ?? voiceOnButton.current)?.focus({ preventScroll: true });
    }
  }, [error]);
  useEffect(() => {
    if (connected || !endPressed.current) return;
    endPressed.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) talkButton.current?.focus({ preventScroll: true });
  }, [connected]);

  // The booth (on a phone the live strip) and the composer stay on screen while the page scrolls:
  // their heights let focus and links scroll clear of them (scroll-padding, styles/assistant.css),
  // and a booth taller than the window sticks by its lower edge.
  useHeightVar(booth, "--booth-h");
  useHeightVar(composerForm, "--composer-h");

  /**
   * Starts a session. `replace`: „Nastavi glasom” in a text conversation, which ends only once the
   * microphone and the connection are ready, so a failure leaves it open.
   */
  async function start(kind: Transport, replace = false) {
    setError(null);
    setStarting(true);
    try {
      if (kind === "webrtc") {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          setError(
            "Mikrofon nije dostupan. Dopustite pristup mikrofonu u pregledniku ili napišite pitanje.",
          );
          return;
        }
      }
      const token = await api.sessionToken(kind);
      if (replace) {
        // „Završi razgovor” pressed meanwhile: the conversation is over, no voice one follows.
        if (!switching.current) return;
        // Ended here, not by the page: no leave confirmation. The new session starts in the same
        // turn, so the SDK drops the old one's late events and onSessionEnd closes it instead.
        endSession();
        onSessionEnd();
      }
      const dynamicVariables = { user_location: place?.name ?? "nepoznato" };
      setTransport(kind);
      onTransport(kind);
      if (kind === "webrtc") {
        startSession(
          token.conversation_token
            ? { conversationToken: token.conversation_token, connectionType: "webrtc", dynamicVariables }
            : { agentId: token.agent_id, connectionType: "webrtc", dynamicVariables },
        );
      } else {
        startSession(
          token.signed_url
            ? { signedUrl: token.signed_url, connectionType: "websocket", textOnly: true, dynamicVariables }
            : { agentId: token.agent_id, connectionType: "websocket", textOnly: true, dynamicVariables },
        );
      }
    } catch (e) {
      // A text conversation that was to go on by voice is still open, as it was.
      if (!replace) setTransport(null);
      pending.current = [];
      setError(errorMessage(e));
    } finally {
      switching.current = false;
      setStarting(false);
    }
  }

  /** A new session sends first what a failed start left unsent, then `more`. */
  function begin(kind: Transport, more: string[] = []) {
    pending.current = [...unsent, ...more];
    if (unsent.length) onResend();
    void start(kind);
  }

  function ask(question: string) {
    const value = question.trim();
    if (!value) return;
    onUserText(value);
    if (connected) {
      sendUserMessage(value);
      return;
    }
    setQueued((prev) => [...prev.filter((q) => q.round === connects), { text: value, round: connects }]);
    if (busy) pending.current.push(value);
    else begin("websocket", [value]);
  }

  /** „Pošalji ponovno”: the questions a failed start left without an answer go out again. */
  function resend() {
    // The button goes while the line connects; the focus waits in the field for what comes next.
    field.current?.focus({ preventScroll: true });
    begin("websocket");
  }

  function talkNow() {
    // Before the first conversation the conversation takes the place of the intro: the focus goes
    // to its headline, then on to „Završi razgovor” once the voice is connected.
    if (phase === "welcome") refocus.current = "heading";
    talkPressed.current = true;
    begin("webrtc");
  }

  /**
   * „Nastavi glasom”: a text conversation goes on as a voice one, started as the microphone
   * would start it. What is on screen stays; the assistant greets anew, as in any new session.
   */
  function continueByVoice() {
    if (busy) return;
    talkPressed.current = true;
    switching.current = true;
    void start("webrtc", true);
  }

  function locateHere() {
    setPlaceFailure(null);
    locate();
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    // „Pošalji” on an empty field sends nothing; it leads back to the field instead.
    if (!text.trim()) {
      field.current?.focus();
      return;
    }
    if (phase === "welcome") refocus.current = "field";
    ask(text);
    setText("");
  }

  /** An example question, asked at once as text (the focus goes on to the conversation's field). */
  function askExample(question: string) {
    if (phase === "welcome") refocus.current = "field";
    ask(question);
  }

  // „Pitaj AI asistenta” on the front page leads to the microphone here. The hand-over is used
  // once and cleared from the history entry, so a reload does not repeat it.
  useEffect(() => {
    const given = handoff.current;
    if (!given) return;
    handoff.current = null;
    void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    // After the layout's own focus on #main, which runs later in this commit (parents' effects
    // run after their children's).
    if (given.focus === "mic") requestAnimationFrame(() => talkButton.current?.focus());
  }, [location.pathname, location.search, navigate]);

  // What the booth shows: a real session, or in development the preview of one.
  const liveShown = connected || preview.live;
  const voiceShown = voice || preview.voice;
  // A text-only session: the answers are not spoken, so it offers to go on by voice.
  const textShown = liveShown && !voiceShown;
  const caption = captionFor({ state, busy, live: liveShown, voice: voiceShown, active: phase === "active", started });
  // Before the first words the transcript is not left blank: the typing dots while the line
  // connects, then a quiet line until the greeting arrives.
  let opening: Opening = null;
  if (!items.length && !thinking) {
    if (busy) opening = { kind: "connecting" };
    else if (voiceShown && !failure) opening = { kind: "hint", text: `Govorite. ${OPENING_HINT}` };
    else if (liveShown || failure) opening = { kind: "hint", text: OPENING_HINT };
  }

  // Announced once per change of the connection. The visible status line is role=status too but
  // stays quiet (aria-live=off): in a voice conversation it changes with every turn, and a screen
  // reader must not talk over the assistant.
  const last = items.at(-1);
  let announced = "";
  if (error && !connected) announced = "Nešto nije u redu.";
  else if (busy) announced = "Spajanje.";
  else if (voice) announced = "Razgovor glasom je počeo. Govorite.";
  else if (connected) announced = "Razgovor tekstom je počeo.";
  // The transcript of a voice conversation stays quiet (aria-live=off), so its end is said here;
  // a text conversation's transcript reads its own end note.
  else if (transport === "webrtc" && last?.kind === "note") announced = last.text;

  // The status line: what is happening now, in a few words.
  const statusLine = (className: string) => (
    <p className={`vstatus ${className}`} role="status" aria-live="off">
      {caption}
    </p>
  );
  const talk = () => <TalkButton ref={talkButton} busy={busy} onClick={talkNow} />;
  // The voice indicator: the microphone button before a session; during a voice one, rings that
  // follow the real voice level around a quiet sign (the button to end it stands under it). A text
  // session keeps the microphone: „Nastavi glasom”, named as the words beside it say (WCAG 2.5.3).
  // While the voice connects it only says so (aria-disabled): a disabled button would drop the
  // keyboard's focus.
  const voiceIndicator = (className: string) => (
    <div className={`voice ${className}`} data-state={state} ref={setIndicator}>
      {textShown ? (
        <button
          ref={voiceOnButton}
          type="button"
          className="mic"
          onClick={busy ? undefined : continueByVoice}
          aria-disabled={busy || undefined}
          aria-label={VOICE_ON}
        >
          <Mic aria-hidden="true" />
        </button>
      ) : liveShown ? (
        <span className="voice__sign" aria-hidden="true">
          <AudioLines />
        </span>
      ) : (
        talk()
      )}
    </div>
  );
  // „U redu” goes with the notice it closes: the focus goes on first, to what one does next.
  const dismiss = () => {
    (resendButton.current ?? talkButton.current ?? voiceOnButton.current ?? endButton.current ?? heading.current)?.focus();
    setError(null);
  };
  const errorNote = (className: string) =>
    failure ? <ErrorNote message={failure} onDismiss={dismiss} className={className} /> : null;
  const placeLine = (className: string) => (
    <PlaceLine
      place={place}
      locating={locating}
      disabled={connected}
      failure={placeFailure}
      onLocate={locateHere}
      onClear={() => setPlace(null)}
      className={className}
    />
  );
  const composer = (className: string, label: string, placeholder: string, ref?: Ref<HTMLFormElement>) => (
    <form className={className} onSubmit={onSubmit} ref={ref}>
      <label htmlFor="message" className="field__label">
        {label}
      </label>
      <div className="field">
        <input
          ref={field}
          id="message"
          type="text"
          autoComplete="off"
          enterKeyHint="send"
          placeholder={placeholder}
          value={text}
          maxLength={500}
          onChange={(e) => {
            setText(e.target.value);
            if (connected) sendUserActivity();
          }}
        />
        <button type="submit" className="field__btn">
          Pošalji
          <SendHorizontal aria-hidden="true" />
        </button>
      </div>
    </form>
  );

  return (
    <div className="assistant">
      <p className="visually-hidden" role="status">
        {announced}
      </p>

      {phase === "welcome" ? (
        <div className="intro">
          <section className="intro__main" aria-labelledby="intro-h">
            <h1 id="intro-h" className="intro__h">
              AI asistent
            </h1>
            <p className="intro__lede">
              Termin, ambulanta ili lijek. Pitajte glasom ili tekstom; odgovor je uvijek i&nbsp;na ekranu.
            </p>
            <div className="intro__talk">
              {voiceIndicator("intro__voice")}
              <div className="intro__talk-text">
                <p className="intro__label" aria-hidden="true">
                  {busy ? "Spajanje…" : "Razgovaraj glasom"}
                </p>
                <MicHint className="intro__hint" />
              </div>
            </div>
            {errorNote("intro__error")}
            {composer("ask intro__ask", "ili napišite pitanje", "npr. MR koljena")}
            {placeLine("intro__loc")}
          </section>
          <section className="intro__ex" aria-labelledby="intro-ex-h">
            <h2 id="intro-ex-h" className="intro__ex-h">
              Primjeri
            </h2>
            <ul className="intro__chips">
              {EXAMPLES.map((q) => (
                <li key={q}>
                  <button type="button" className="qchip" onClick={() => askExample(q)}>
                    {q}
                  </button>
                </li>
              ))}
            </ul>
            <p className="intro__fine">
              Ne postavlja dijagnoze i&nbsp;ne naručuje. Hitno: <a href="tel:112">112</a>.
            </p>
          </section>
        </div>
      ) : (
        <div className={voiceShown ? "convo convo--voice" : "convo"}>
          <div className="grid convo__grid">
            <aside
              className={liveShown ? "booth booth--live" : "booth"}
              aria-label="Upravljanje razgovorom"
              ref={setBooth}
            >
              {statusLine("booth__status")}
              {voiceIndicator("booth__voice")}
              <div className="booth__text">
                {voiceShown ? (
                  <p className="booth__mic">
                    <span className="lamp" aria-hidden="true" />
                    Mikrofon uključen
                  </p>
                ) : textShown ? (
                  // The microphone's words (the button carries them as its name).
                  <p className="booth__mic" aria-hidden="true">
                    {VOICE_ON}
                  </p>
                ) : !liveShown && !busy && transport === "webrtc" ? (
                  // After a voice conversation, the lamp's last word; a text one never had it on.
                  <p className="booth__mic booth__mic--off">Mikrofon isključen</p>
                ) : null}
              </div>
              {voiceShown ? (
                <p className="booth__time">
                  <span className="booth__time-w">Razgovor glasom traje </span>
                  <Clock since={since} fixed={preview.live ? PREVIEW_ELAPSED : null} />
                </p>
              ) : null}
              {liveShown ? <span className="booth__level" aria-hidden="true" /> : null}
              {liveShown ? (
                <button
                  ref={endButton}
                  type="button"
                  className="btn btn--red booth__end"
                  aria-label="Završi razgovor"
                  onClick={() => {
                    endPressed.current = true;
                    switching.current = false;
                    endSession();
                  }}
                >
                  <PhoneOff aria-hidden="true" />
                  <span>
                    Završi<span className="booth__end-w"> razgovor</span>
                  </span>
                </button>
              ) : null}
              {(!liveShown || textShown) && !busy ? <MicHint className="booth__hint" /> : null}
              {errorNote("booth__error")}
              {placeLine("booth__place")}
            </aside>

            <section className="transcript" aria-labelledby="t-h">
              <h1 id="t-h" className="transcript__h" tabIndex={-1} ref={heading}>
                Razgovor s&nbsp;asistentom
              </h1>
              <Byline
                firstSince={firstSince ?? since ?? preview.since}
                mode={preview.live ? (preview.voice ? "webrtc" : "websocket") : transport}
              />
              <div className="transcript__scroll" ref={scroller}>
                <div className="transcript__flow">
                  {/* Quiet in a voice conversation (the assistant is heard, not read out) and
                      after it, so its end is said once, by the status above; a typed question
                      starts a text conversation, which is read. */}
                  <ol className="turns" aria-live={transport === "webrtc" ? "off" : "polite"} aria-relevant="additions">
                    <Turns items={items} thinking={thinking} opening={opening} onPick={ask} />
                  </ol>
                  {/* Under the questions a failed start left unanswered (the notice in the booth
                      says why); outside the live list, so it is not read out twice. */}
                  {unsent.length ? (
                    <p className="unsent">
                      <span>{unsent.length > 1 ? "Pitanja nisu poslana." : "Pitanje nije poslano."}</span>
                      <button ref={resendButton} type="button" className="btn btn--sm" onClick={resend}>
                        <RotateCw aria-hidden="true" />
                        Pošalji ponovno
                      </button>
                    </p>
                  ) : null}
                  <Sources />
                </div>
              </div>
              {composer("composer ask", "Vaše pitanje", "npr. a u Splitu?", setComposerForm)}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
