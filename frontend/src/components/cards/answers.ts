/**
 * Plain facts about answers and coupons, shared by the answer cards, the
 * coupons and the front page's example, so they always say the same thing.
 */
import { authorisedOf } from "../../drugs";
import { NBSP, days, fmt, monthYear, stampYearHr } from "../../format";
import type { Card, DrugData, DrugProduct, Facility, WaitOption, WaitingData } from "../../types";
import { couponOptions, procedureLabel } from "../../waiting";

/** What every answer figure takes (components/cards/ResponseCard.tsx). */
export interface AnswerProps {
  card: Card;
  /** The answer's number in the conversation: id „odgovor-n”, so the conversation can point at it. */
  n?: number;
  /**
   * The headline's level. 2 by default: the transcript's only heading above the answers is the
   * page's h1, and coupon names inside an answer are one level below it.
   */
  headingLevel?: 2 | 3 | 4;
  /** Also print the spoken summary (the transcript usually has it already). */
  showSummary?: boolean;
  /**
   * The assistant's words in the same turn of the conversation. An answer whose only text is the
   * tool's sentence (an unclear question, no data) leaves it out when the assistant has just said it.
   */
  said?: string;
  /** When set, the candidates of an unclear question are buttons that ask the assistant again. */
  onPick?: (text: string) => void;
}

/** The middle dot between facts, held to the word before it: a line never starts with „·”. */
export const SEP = `${NBSP}· `;

/** Letters and digits only, lower case: what a sentence says, whatever its quotes and spaces. */
function bare(text: string): string {
  return text
    .toLocaleLowerCase("hr-HR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whether the assistant's words already contain the tool's sentence (its first sentence is enough:
 * the assistant reads the sentence as it is). Then the answer under them does not print it again.
 */
export function saidAlready(said: string | undefined, sentence: string): boolean {
  const first = bare(sentence.split(/(?<=[.!?])\s/)[0] ?? "");
  return Boolean(said && first.length > 12 && bare(said).includes(first));
}

/* ------------------------------------------------------------ waiting lists */

/** The options under the coupons (roles "nearby" and "soon"): rows „u blizini”. */
export function rowOptions(options: WaitOption[]): WaitOption[] {
  const coupons = new Set(couponOptions(options));
  return options.filter((o) => !coupons.has(o));
}

/** "danas" / "sutra" for 0 and 1 day, otherwise null (the number and „dana” are shown). */
export function waitWord(wait: number): string | null {
  return wait <= 0 ? "danas" : wait === 1 ? "sutra" : null;
}

/** For a sentence or a label: "za 69 dana", "sutra", "danas". */
export function waitPhrase(wait: number): string {
  return waitWord(wait) ?? `za ${days(wait)}`;
}

/** Distance from the asker's place: "u vašem mjestu", "oko 341 km"; null without a place. */
export function kmWords(km: number | null | undefined, short = false): string | null {
  if (km === null || km === undefined) return null;
  if (km < 2) return `u${NBSP}vašem${NBSP}mjestu`;
  return `${short ? "" : "oko "}${fmt(km)}${NBSP}km`;
}

/* ------------------------------------------------------------ facilities */

export const FACILITY_TITLE: Record<string, string> = {
  family_medicine: "Opća medicina",
  pediatrics: "Pedijatrija",
  gynecology: "Ginekologija",
  dentistry: "Dentalna zaštita",
  hospital: "Bolnice",
  any: "Zdravstvene ustanove",
};

/** The month HZZO's list of practices or hospitals describes: "rujna 2026." */
function facilitiesMonth(data: Record<string, unknown>): string {
  const type = (data.facility_type as string | undefined) ?? "any";
  const asOf = data.data_as_of as { pzz?: string; hospitals?: string } | undefined;
  return monthYear(type === "hospital" ? asOf?.hospitals : asOf?.pzz);
}

/** Every facility shown is in the place itself (then the title says „u mjestu”). */
export function allInPlace(facilities: Facility[]): boolean {
  return facilities.length > 0 && facilities.every((f) => f.distance_km < 0.5);
}

/* ------------------------------------------------------------ medicines */

/** The forms a medicine card shows: those still authorised, as the spoken summary counts them
 * (the medicine's page lists the revoked ones too). */
export function drugProducts(card: Card): DrugProduct[] {
  const d = card.data as Partial<DrugData>;
  return authorisedOf((card.extra.products as DrugProduct[] | undefined) ?? d.products ?? []).slice(0, 40);
}

/* ------------------------------------------------------------ titles and sources */

/**
 * Without a place, an answer with no data is headed by what it is about, so the headline and the
 * run-in under it („Nema podataka. Liste čekanja HZZO-a trenutno nisu dostupne.”) never say the
 * same thing twice.
 */
const NO_DATA_TITLE: Record<string, string> = {
  find_waiting_times: "Liste čekanja",
  get_drug_info: "Lijekovi",
  find_health_facilities: "Ordinacije i bolnice",
};

/** The headline when nothing is known about an answer: the run-in then drops its label. */
export const NO_DATA = "Nema podataka";

/** The headline of an answer that has no figure of its own: the place, or what it is about. */
export function statusTitle(card: Card): string {
  if (card.status === "no_data" && card.tool === "find_waiting_times" && card.data.procedure) {
    return procedureLabel((card.data as Partial<WaitingData>).procedure?.name ?? "");
  }
  if (card.location?.name) return card.location.name;
  if (card.status === "ambiguous") return "Treba pojasniti";
  if (card.status === "not_found") return "Nije pronađeno";
  if (card.status === "error") return "Podaci trenutno nisu dostupni";
  return NO_DATA_TITLE[card.tool] ?? NO_DATA;
}

export interface SourceNoteParts {
  /** Who published the data: „HZZO”, „HALMED”. */
  publisher: string;
  /** The rest of the note: „, liste čekanja (CEZIH), ažurirano 27. 10. 2026. u 22:50.” */
  rest: string;
}

/**
 * The source of an answer, for its last line: „HZZO, liste čekanja (CEZIH), ažurirano
 * 27. 10. 2026. u 22:50.” Null for an answer without a source (an error).
 */
export function answerSource(card: Card): SourceNoteParts | null {
  const when = stampYearHr(card.updated_at);
  const updated = when ? `, ažurirano ${when}` : "";
  if (card.tool === "find_waiting_times" && card.source.startsWith("HZZO")) {
    return { publisher: "HZZO", rest: `, liste čekanja (CEZIH)${updated}.` };
  }
  if (card.tool === "get_drug_info" && card.source.startsWith("HALMED")) {
    return drugSource(card.updated_at, (card.data as Partial<DrugData>).hzzo_lists_in_force_hr);
  }
  if (card.tool === "find_health_facilities" && card.status === "ok") {
    const hospital = card.data.facility_type === "hospital";
    const month = facilitiesMonth(card.data);
    const what = hospital ? "bolnice s ugovorom" : "ordinacije primarne zdravstvene zaštite";
    return { publisher: "HZZO", rest: `, ${what}${month ? `, popis iz ${month}` : `${updated}.`}` };
  }
  if (!card.source || card.status === "error") return null;
  const [publisher = card.source, ...rest] = card.source.split(", ");
  return { publisher, rest: `${rest.length ? `, ${rest.join(", ")}` : ""}${updated}.` };
}

/** HALMED's database and HZZO's lists: „HALMED, baza lijekova, ažurirano …; HZZO, liste lijekova od …” */
export function drugSource(updatedAt: string | null | undefined, lists: string | null | undefined): SourceNoteParts {
  const when = stampYearHr(updatedAt);
  const updated = when ? `, ažurirano ${when}` : "";
  return { publisher: "HALMED", rest: `, baza lijekova${updated}${lists ? `; HZZO, liste lijekova od ${lists}` : "."}` };
}
