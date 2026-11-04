/** The conversation as read: its byline, the turns with their answer cards, and the sources. */
import { ResponseCard } from "../../components/cards/ResponseCard";
import { Typeset } from "../../components/Typeset";
import { NBSP, capitalize, dayLongHr, plural, timeHr } from "../../format";
import type { Card } from "../../types";
import type { Item, Transport } from "./session";

/** „Srijeda, 28. listopada 2026., od 10:38 · glasom · glas se ne snima” */
export function Byline({ firstSince, mode }: { firstSince: number | null; mode: Transport | null }) {
  const day = capitalize(dayLongHr(firstSince === null ? new Date() : new Date(firstSince)));
  return (
    <p className="byline transcript__by">
      {day}
      {firstSince === null ? "" : `, od${NBSP}${timeHr(firstSince)}`}
      {mode ? `${NBSP}· ${mode === "webrtc" ? "glasom" : "tekstom"}` : ""}
      {mode === "websocket" ? "" : `${NBSP}· glas se ne${NBSP}snima`}
    </p>
  );
}

type Block = { kind: "said"; id: number; text: string } | { kind: "card"; id: number; card: Card; n: number };

type Turn =
  | { kind: "you"; id: number; text: string }
  | { kind: "up"; id: number; blocks: Block[] }
  | { kind: "end"; id: number; text: string; answers: number };

/** The transcript before the first words: the typing dots while the line connects, or a quiet hint. */
export type Opening = { kind: "connecting" } | { kind: "hint"; text: string } | null;

/**
 * The timeline as an interview: each question of yours, then the assistant's turn with its words
 * and, under them, the answers that arrived in that turn (numbered 1, 2, 3 … in the order they came).
 * An answer may arrive before the words that go with it; the words still come first. The end of a
 * session counts the answers it brought.
 */
function toTurns(items: Item[]): Turn[] {
  const turns: Turn[] = [];
  let answers = 0;
  let sessionStart = 0;
  for (const item of items) {
    if (item.kind === "note") {
      turns.push({ kind: "end", id: item.id, text: item.text, answers: answers - sessionStart });
      sessionStart = answers;
      continue;
    }
    if (item.kind === "msg" && item.role === "user") {
      turns.push({ kind: "you", id: item.id, text: item.text });
      continue;
    }
    const block: Block =
      item.kind === "card"
        ? { kind: "card", id: item.id, card: item.card, n: ++answers }
        : { kind: "said", id: item.id, text: item.text };
    const last = turns.at(-1);
    if (last?.kind !== "up") turns.push({ kind: "up", id: item.id, blocks: [block] });
    else if (block.kind === "said" && !last.blocks.some((b) => b.kind === "said")) last.blocks.unshift(block);
    else last.blocks.push(block);
  }
  return turns;
}

/**
 * The line that closes a session: „Razgovor je završen u 10:42 · trajao 4:12 · 3 odgovora.” (the
 * count only when the session brought answers).
 */
function endLine(text: string, answers: number): string {
  if (!answers) return text;
  const count = `${answers}${NBSP}${plural(answers, "odgovor", "odgovora", "odgovora")}`;
  return `${text.replace(/\.$/, "")}${NBSP}· ${count}.`;
}

/** The assistant's words in a turn, for the answers under them (an answer does not repeat them). */
function saidIn(turn: Extract<Turn, { kind: "up" }>): string {
  return turn.blocks.flatMap((b) => (b.kind === "said" ? [b.text] : [])).join(" ");
}

export function Turns({
  items,
  thinking,
  opening,
  onPick,
}: {
  items: Item[];
  thinking: boolean;
  opening: Opening;
  onPick: (text: string) => void;
}) {
  const turns = toTurns(items);
  const last = turns.at(-1);
  // Answers already in, words still to come: the dots wait inside that turn.
  const waitsInLast = thinking && last?.kind === "up" && !last.blocks.some((b) => b.kind === "said");
  return (
    <>
      {/* Hidden from screen readers: the status and the caption already say this. */}
      {opening ? (
        <li className="turn turn--up turn--opening" aria-hidden="true">
          <p className="who">Asistent</p>
          <div className="turn__body">
            {opening.kind === "connecting" ? <Thinking /> : <p className="said said--hint">{opening.text}</p>}
          </div>
        </li>
      ) : null}
      {turns.map((turn) =>
        turn.kind === "you" ? (
          <li key={turn.id} className="turn turn--you">
            <p className="who">
              Vi<span className="visually-hidden">:</span>
            </p>
            <p className="said">
              <Typeset text={turn.text} />
            </p>
          </li>
        ) : turn.kind === "end" ? (
          <li key={turn.id} className="turns__end">
            <span aria-hidden="true">∎ </span>
            {endLine(turn.text, turn.answers)}
          </li>
        ) : (
          <li key={turn.id} className="turn turn--up">
            <p className="who">
              Asistent<span className="visually-hidden">:</span>
            </p>
            <div className="turn__body">
              {waitsInLast && turn === last ? <Thinking /> : null}
              {turn.blocks.map((block) =>
                block.kind === "said" ? (
                  <p key={block.id} className="said">
                    <Typeset text={block.text} />
                  </p>
                ) : (
                  <ResponseCard key={block.id} card={block.card} n={block.n} onPick={onPick} said={saidIn(turn)} />
                ),
              )}
            </div>
          </li>
        ),
      )}
      {thinking && !waitsInLast ? (
        <li className="turn turn--up turn--wait">
          <p className="who" aria-hidden="true">
            Asistent
          </p>
          <div className="turn__body">
            <Thinking />
          </div>
        </li>
      ) : null}
    </>
  );
}

/** Three dots while the answer is on its way (still with reduced motion). */
function Thinking() {
  return (
    <p className="said said--wait">
      <span className="visually-hidden">Asistent traži podatke</span>
      <span className="typing" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </p>
  );
}

/** Under the conversation: how the answers are made (each answer card names its own source). */
export function Sources() {
  return (
    <p className="small sources">
      Brojke i&nbsp;nazive slaže sustav iz službenih podataka, ne jezični model. Bez medicinskih savjeta.
    </p>
  );
}
