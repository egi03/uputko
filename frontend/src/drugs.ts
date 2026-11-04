import { NBSP, fmt } from "./format";
import type { DrugProduct, HzzoList } from "./types";

export type ListKind = "oll" | "dll" | "both" | "hospital" | "none";

interface ListSummary {
  kind: ListKind;
  some: boolean; // only some of the products are on a list
  copayMin: number | null;
  copayMax: number | null;
}

/** What HZZO's lists say about these products (the same rules as the spoken answer). */
export function listSummary(products: DrugProduct[]): ListSummary {
  const listed = products.filter((p) => p.hzzo_list);
  const kinds = new Set(listed.flatMap((p) => (p.hzzo_list ?? "").split("+")));
  const lows = listed.map((p) => p.copay_min_eur).filter((v): v is number => v !== null);
  const highs = listed.map((p) => p.copay_max_eur).filter((v): v is number => v !== null);
  let kind: ListKind = "none";
  if (kinds.has("OLL") && kinds.has("DLL")) kind = "both";
  else if (kinds.has("DLL")) kind = "dll";
  else if (kinds.has("OLL")) kind = listed.every((p) => p.hospital_only) ? "hospital" : "oll";
  return {
    kind,
    some: listed.length > 0 && listed.length < products.length,
    copayMin: lows.length ? Math.min(...lows) : null,
    copayMax: highs.length ? Math.max(...highs) : null,
  };
}

/** HALMED revoked the authorisation of this form. */
export const isRevoked = (p: DrugProduct): boolean => p.revoked === true;

/** The forms still authorised (all of them when none is): what the spoken summary speaks of. */
export function authorisedOf(products: DrugProduct[]): DrugProduct[] {
  const live = products.filter((p) => !isRevoked(p));
  return live.length ? live : products;
}

/** HALMED's own words for a form's state, as the backend passes them on (market, shortage, issuing). */
export const HALMED = {
  onMarket: "stavljeno u promet",
  paused: "privremeni prekid opskrbe",
  ended: "trajni prekid opskrbe",
  neverMarketed: "nije stavljeno u promet",
  shortage: "u tijeku",
  noShortage: "nema nestašice",
  rx: "na recept",
  otc: "bez recepta",
} as const;

/** HALMED: the form was never put on the market, or its supply has ended for good. */
const OFF_MARKET: readonly string[] = [HALMED.ended, HALMED.neverMarketed];
export const isOffMarket = (p: DrugProduct): boolean => OFF_MARKET.includes(p.market_status ?? "");

/**
 * Why a medicine cannot be had, in the words under „nije u prometu”: every form revoked, or every
 * authorised form off the market; null otherwise. The page and the conversation card say this
 * before any price, which would suggest it can be bought.
 */
export function unavailable(products: DrugProduct[]): string | null {
  if (!products.length) return null;
  if (products.every(isRevoked)) return "HALMED je ukinuo odobrenje";
  return authorisedOf(products).every(isOffMarket) ? "prema HALMED-u" : null;
}

/** "Ultop 20 mg želučanootporne tvrde kapsule" under the headword "Ultop": "20 mg želučanootporne…". */
export function brandOf(p: DrugProduct, label: string): string {
  const prefix = p.name.startsWith(label) ? label : p.brand;
  return p.name.startsWith(prefix) ? p.name.slice(prefix.length).trim() || p.name : p.name;
}

/* ------------------------------------------------------------ HZZO lists: balls and words */

/** A Harvey ball: ● osnovna lista, ◐ dopunska lista, ○ not on the lists. */
export type Ball = "oll" | "dll" | "none";

/** The balls for one product's list: one, or two when it is on both lists ("DLL+OLL"). */
export function ballsOf(list: HzzoList | null | undefined): Ball[] {
  const parts = (list ?? "").split("+");
  const balls: Ball[] = [];
  if (parts.includes("OLL")) balls.push("oll");
  if (parts.includes("DLL")) balls.push("dll");
  return balls.length ? balls : ["none"];
}

/** The balls of a list summary (a medicine with several forms). */
export function ballsOfKind(kind: ListKind): Ball[] {
  if (kind === "both") return ["oll", "dll"];
  if (kind === "dll") return ["dll"];
  if (kind === "none") return ["none"];
  return ["oll"];
}

/**
 * One product's list in words, always next to its ball: "dopunska", "osnovna i dopunska",
 * "osnovna, samo u bolnici", "nije na listama".
 */
export function listWord(p: Pick<DrugProduct, "hzzo_list" | "hospital_only">): string {
  const balls = ballsOf(p.hzzo_list);
  if (balls[0] === "none") return "nije na listama";
  const words = balls.map((b) => (b === "oll" ? "osnovna" : "dopunska")).join(" i ");
  return `${words}${p.hospital_only ? `, samo u${NBSP}bolnici` : ""}`;
}

/** A list code from HZZO in words: „osnovna lista”, „osnovna i dopunska lista”, „nije na listama”. */
export function listName(list: HzzoList | null | undefined): string {
  const balls = ballsOf(list);
  if (balls[0] === "none") return "nije na listama";
  return balls.length > 1 ? "osnovna i dopunska lista" : balls[0] === "dll" ? "dopunska lista" : "osnovna lista";
}

/** A medicine's lists in words (several forms): "dopunska lista", "osnovna lista, samo u bolnici". */
export function kindWord(kind: ListKind): string {
  return {
    oll: "osnovna lista",
    dll: "dopunska lista",
    both: "osnovna i dopunska lista",
    hospital: `osnovna lista, samo u${NBSP}bolnici`,
    none: "nije na listama",
  }[kind];
}

/** A co-payment as printed: "1,29–1,82 €" (en dash, no-break space; never tabular). */
export function euroRange(min: number | null | undefined, max: number | null | undefined): string | null {
  const lo = min ?? max;
  const hi = max ?? min;
  if (lo === null || lo === undefined || hi === null || hi === undefined) return null;
  return lo === hi ? `${fmt(lo, 2)}${NBSP}€` : `${fmt(lo, 2)}–${fmt(hi, 2)}${NBSP}€`;
}

/* ------------------------------------------------------------ dispensing (HALMED) */

interface Dispensing {
  /** "rx": every form needs a prescription; "both": some do. */
  kind: "rx" | "otc" | "both" | null;
  /** "na recept", "bez recepta", "na recept i bez recepta"; null when HALMED says nothing. */
  text: string | null;
  /** The kinds of prescription, short: ["ponovljivi"], ["ograničeni", "poseban"]. */
  prescriptions: string[];
}

export function dispensingOf(products: DrugProduct[]): Dispensing {
  const rx = products.some((p) => p.rx === HALMED.rx);
  const otc = products.some((p) => p.rx === HALMED.otc);
  const kind = rx && otc ? "both" : rx ? "rx" : otc ? "otc" : null;
  const text = kind === "both" ? "na recept i bez recepta" : kind === "rx" ? "na recept" : kind === "otc" ? "bez recepta" : null;
  // "ponovljivi recept (tableta, filmom obložena tableta)" -> "ponovljivi"
  const prescriptions = [
    ...new Set(
      products
        .map((p) => (p.prescription ?? "").replace(/\s*\(.*$/, "").replace(/\s*recept$/, "").trim())
        .filter(Boolean),
    ),
  ];
  return { kind, text, prescriptions: kind === "otc" ? [] : prescriptions };
}

/* ------------------------------------------------------------ the market (HALMED) */

/** What HALMED reports that a reader must not miss; null when nothing is wrong or nothing is known. */
type MarketAlert = "shortage" | "paused" | "off";

interface MarketState {
  alert: MarketAlert | null;
  /** At least one form is on the market (HALMED: "stavljeno u promet"). */
  inMarket: boolean;
}

/** Only statuses HALMED publishes: many EU-authorised medicines have none, and then we say nothing. */
export function marketOf(products: DrugProduct[]): MarketState {
  const statuses = new Set(products.map((p) => p.market_status).filter(Boolean));
  const shortages = products.map((p) => p.shortage).filter(Boolean);
  const inMarket = statuses.has(HALMED.onMarket);
  let alert: MarketAlert | null = null;
  if (shortages.includes(HALMED.shortage)) alert = "shortage";
  else if (statuses.has(HALMED.paused)) alert = "paused";
  else if (statuses.size > 0 && !inMarket) alert = "off";
  return { alert, inMarket };
}
