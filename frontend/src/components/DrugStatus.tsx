import { type Ball, ballsOf, ballsOfKind, type ListKind, listSummary, marketOf } from "../drugs";
import { NBSP, typesetHr } from "../format";
import type { DrugProduct, HzzoList } from "../types";
import { SEP } from "./cards/answers";
import { Ac } from "./Typeset";

/**
 * A Harvey ball: ● osnovna lista, ◐ dopunska lista, ○ not on the lists.
 * The shape carries the meaning, so it reads in black and white; a word always goes with it.
 * Fill and stroke are drawn by the SVG itself (it reads the same without the stylesheet, e.g. in
 * a reader view); colour and size come from .hb in cards.css. The one drawing for every page.
 */
export function HarveyBall({ kind }: { kind: Ball }) {
  return (
    <svg className={`hb hb--${kind}`} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.4" fill={kind === "oll" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" />
      {kind === "dll" ? <path d="M8 1.6a6.4 6.4 0 0 1 0 12.8Z" fill="currentColor" /> : null}
    </svg>
  );
}

/** One ball, or two for a product on both lists ("● ◐ osnovna i dopunska"). */
export function ListBalls({ list, kind }: { list?: HzzoList | null; kind?: ListKind }) {
  const balls = kind ? ballsOfKind(kind) : ballsOf(list);
  return (
    <span className="hbs">
      {balls.map((b) => (
        <HarveyBall key={b} kind={b} />
      ))}
    </span>
  );
}

const LIST_LINE: Record<ListKind, { title: string; text: string }> = {
  oll: { title: "Osnovna lista", text: "bez doplate uz recept" },
  dll: { title: "Dopunska lista", text: "uz recept se plaća doplata" },
  both: { title: "Osnovna i dopunska lista", text: "neka pakiranja bez doplate, neka uz doplatu" },
  hospital: { title: "Osnovna lista", text: "samo u bolnici" },
  none: { title: "Nije na listama", text: "" },
};

/**
 * Which HZZO list the medicine is on and what that means at the pharmacy, in one line with its
 * Harvey ball: „◐ Dopunska lista HZZO-a · uz recept se plaća doplata”. When only some forms are
 * listed, it says so. (The date the lists apply from is in the card's source line.)
 */
export function ListBand({ products }: { products: DrugProduct[] }) {
  const s = listSummary(products);
  const line = LIST_LINE[s.kind];
  return (
    <p className="drug__list">
      <ListBalls kind={s.kind} />
      <span>
        <b>
          {line.title} <Ac end="a">HZZO</Ac>
        </b>
        {line.text ? `${SEP}${typesetHr(line.text)}` : null}
        {s.some && s.kind !== "none" ? `${SEP}samo neki oblici` : ""}
      </span>
    </p>
  );
}

const ALERT = {
  shortage: { label: "Nestašica.", text: "bilježi nestašicu nekih pakiranja." },
  paused: { label: "Privremeni prekid opskrbe.", text: "bilježi privremeni prekid opskrbe nekih oblika." },
  off: { label: `Nije u${NBSP}prometu.`, text: "" },
} as const;

/** HALMED's market news, only when it is not the ordinary „u prometu”: one line with a red label. */
export function MarketNote({ products }: { products: DrugProduct[] }) {
  const { alert } = marketOf(products);
  if (!alert) return null;
  const a = ALERT[alert];
  return (
    <p className="drug__alert">
      <b>{a.label}</b>{" "}
      {alert === "off" ? (
        <>
          Prema <Ac end="u">HALMED</Ac> lijek trenutno nije u{NBSP}prometu u{NBSP}Hrvatskoj.
        </>
      ) : (
        <>
          <Ac>HALMED</Ac> {a.text}
        </>
      )}
    </p>
  );
}
