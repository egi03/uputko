import { fmt, NBSP, plural } from "./format";
import type { Location, WaitingData, WaitingExample, WaitOption, WaitRole } from "./types";

export const ROLE_LABELS: Record<WaitRole, string> = {
  nearest: "Najbliže vama",
  sooner_nearby: "Ranije u blizini",
  soonest_croatia: "Najranije u Hrvatskoj",
  nearby: "U blizini",
  soon: "Uskoro",
  list: "",
};

export function distanceText(km: number | null): string {
  if (km === null) return "lokacija nije poznata";
  return km < 2 ? "u vašem mjestu" : `oko ${fmt(km)}${NBSP}km`;
}

/** "Najranije u Hrvatskoj" only when it is the soonest of all lists, as in the spoken answer. */
export function roleLabel(o: WaitOption, all: WaitOption[]): string {
  if (o.role === "soonest_croatia" && all.some((e) => e.wait_days < o.wait_days)) return "Puno ranije, dalje od vas";
  return ROLE_LABELS[o.role];
}

/** The answer's options that become coupons; "nearby" and "soon" lead the table. */
const COUPON_ROLES: readonly WaitRole[] = ["nearest", "sooner_nearby", "soonest_croatia"];

export function couponOptions(options: WaitOption[]): WaitOption[] {
  return options.filter((o) => COUPON_ROLES.includes(o.role)).slice(0, 3);
}

/**
 * Where a wait stands against the Croatian median for the same procedure: the one scale of the
 * bars, the chart's dots and the coupon numbers (≤ 0,85 shorter, < 1,15 about the same, longer
 * beyond).
 */
export type WaitTone = "short" | "mid" | "long";

export function waitTone(days: number, median: number | null | undefined): WaitTone {
  if (median === null || median === undefined) return "mid";
  if (median <= 0) return days <= 0 ? "mid" : "long";
  const ratio = days / median;
  return ratio <= 0.85 ? "short" : ratio < 1.15 ? "mid" : "long";
}

/** A piece of a results headline: words, or a figure the page sets in light numerals. */
export type HeadlinePart = string | { n: number };

/**
 * "za 69 dana", "za 9" (the unit said once is enough), "već danas", "već sutra"; "već za 30" when
 * the figure is the earlier one nearby.
 */
function inDays(days: number, unit: boolean, already = false): HeadlinePart[] {
  if (days <= 0) return ["već danas"];
  if (days === 1) return ["već sutra"];
  const unitWord = unit ? `${NBSP}${plural(days, "dan", "dana", "dana")}` : "";
  return [already ? `već za${NBSP}` : `za${NBSP}`, { n: days }, unitWord];
}

/**
 * The results headline from the answer's options: „Najbliže za 69 dana, najranije za 9”,
 * „Najbliže i najranije za 69 dana”, „Najranije za 9 dana” without a place, „Prvi slobodni termin
 * za 9 dana” when one institution has a slot. Empty when nothing is free.
 */
export function headlineParts(options: WaitOption[], entries: WaitOption[]): HeadlinePart[] {
  const listed = entries.length ? entries : options;
  if (!options.length || !listed.length) return [];
  const soonest = Math.min(...listed.map((e) => e.wait_days));
  const nearest = options.find((o) => o.role === "nearest");
  const other = options.find((o) => o.role === "sooner_nearby" || o.role === "soonest_croatia");
  const first = nearest ?? options[0];
  if (!first) return [];
  if (listed.length === 1) return ["Prvi slobodni termin ", ...inDays(first.wait_days, true)];
  if (!nearest) return ["Najranije ", ...inDays(first.wait_days, true)];
  if (!other) {
    const alsoSoonest = nearest.wait_days <= soonest;
    return [alsoSoonest ? `Najbliže i${NBSP}najranije ` : "Najbliže ", ...inDays(nearest.wait_days, true)];
  }
  const near = inDays(nearest.wait_days, true);
  // The unit stays with the first figure; a "danas" or "sutra" first leaves the second its own.
  const unitSaid = nearest.wait_days > 1;
  const nearby = other.role === "sooner_nearby";
  const lead = nearby ? `u${NBSP}blizini ` : other.wait_days <= soonest ? "najranije " : "dalje od vas ";
  return ["Najbliže ", ...near, `, ${lead}`, ...inDays(other.wait_days, !unitSaid, nearby)];
}

/**
 * The answer's two options that make its point, if it has them: the nearest appointment and the
 * sooner one beside it (nearby, or the soonest in Croatia). The page's headline, the conversation
 * card and the front page say them as „za 22 dana umjesto 265”.
 */
export function nearestAndSooner(options: WaitOption[]): { nearest: WaitOption; sooner: WaitOption } | null {
  const nearest = options.find((o) => o.role === "nearest");
  const sooner = options.find((o) => o.role === "sooner_nearby" || o.role === "soonest_croatia");
  return nearest && sooner && sooner.wait_days < nearest.wait_days ? { nearest, sooner } : null;
}

/** „Za 22 dana umjesto 265”, „Već sutra umjesto za 70 dana” as a headline (figures marked). */
export function insteadParts(soonerDays: number, nearestDays: number): HeadlinePart[] {
  const unit = (n: number) => `${NBSP}${plural(n, "dan", "dana", "dana")}`;
  if (soonerDays <= 0) return ["Već danas umjesto za ", { n: nearestDays }, unit(nearestDays)];
  if (soonerDays === 1) return ["Već sutra umjesto za ", { n: nearestDays }, unit(nearestDays)];
  return [`Za${NBSP}`, { n: soonerDays }, `${unit(soonerDays)} umjesto `, { n: nearestDays }];
}

/** The same in one line of text. */
export function insteadText(soonerDays: number, nearestDays: number): string {
  return insteadParts(soonerDays, nearestDays)
    .map((p) => (typeof p === "string" ? p : fmt(p.n)))
    .join("");
}

/**
 * One institution on a list, for React keys and the page's linked highlight (data-inst): private
 * practices share one descriptive name, so the id tells them apart (the name in older cards).
 */
export function instKey(o: { institution_id?: number; institution: string }): string {
  return o.institution_id === undefined ? o.institution : String(o.institution_id);
}

/** /termini with the example's procedure and place: the page shows the same numbers. */
export function exampleLink(e: WaitingExample): string {
  const params = new URLSearchParams({
    postupak: String(e.procedure.id),
    mjesto: placeParam(e.location.name, e.location.county, e.location.municipality),
  });
  return `/termini?${params.toString()}`;
}

/** „Kardiologija (prvi pregled)”: the example's label as said, with a capital. */
export function exampleTitle(e: WaitingExample): string {
  const label = e.procedure.label;
  return `${label.charAt(0).toLocaleUpperCase("hr")}${label.slice(1)}`;
}

/**
 * A place as the URL carries it: the settlement, its city or municipality and its county, so a
 * name that several settlements share („Novo Selo”, two „Bukevje” in Zagrebačka) resolves at once
 * instead of asking „Postoji više mjesta…” again („Bukevje, Općina Orle, Zagrebačka”).
 */
export function placeParam(name: string, county?: string | null, municipality?: string | null): string {
  return [...new Set([name, municipality, county].filter(Boolean))].join(", ");
}

/** The settlement in a place parameter: "Novo Selo, Sisačko-moslavačka" -> "Novo Selo". */
export function placeName(param: string): string {
  return param.split(",")[0]?.trim() || param;
}

/**
 * /termini with the same procedure and place. With the answer's location its municipality and
 * county go along (placeParam), so the page opens the same answer even for a place name shared
 * by several settlements.
 */
export function termsLink(d: Partial<WaitingData>, location?: Location | null): string {
  const params = new URLSearchParams();
  if (d.procedure?.id) params.set("postupak", String(d.procedure.id));
  if (location?.name) params.set("mjesto", placeParam(location.name, location.county, location.municipality));
  else if (d.origin) params.set("mjesto", d.origin);
  return `/termini?${params.toString()}`;
}

/**
 * The tools' summaries are written to be spoken (the voice agents read the same answers). On a
 * page a few of their turns would ask the reader to say something out loud; they are put the way
 * a page asks, and the facts stay as they are. Text that does not match is left alone.
 */
const SPOKEN_TURNS: [RegExp, string][] = [
  // Without a place the page offers the place itself (the slot, „Moja lokacija”, the empty
  // coupon), so the sentence that asks for it goes.
  [/\s*Za najbliži termin recite mjesto\./u, ""],
  [
    /Recite ga drugim riječima, na primjer kako piše na uputnici\./u,
    "Napišite ga drugim riječima, na primjer kako piše na uputnici.",
  ],
  [/Ponovite naziv ili recite najbliži veći grad\./u, "Provjerite naziv ili upišite najbliži veći grad."],
];

export function writtenSummary(text: string): string {
  return SPOKEN_TURNS.reduce((t, [spoken, written]) => t.replace(spoken, written), text).trim();
}

/**
 * „za MR koljena”, „za postupak Kolonoskopija”: a name that starts with an acronym reads as it
 * is; any other cannot be declined by a template, so it stands after „postupak”.
 */
export function forProcedure(label: string): string {
  return /^\p{Lu}{2,}/u.test(label) ? `za ${label}` : `za postupak ${label}`;
}

/** „Vukovarsko-srijemska županija”, „Grad Zagreb”. */
export function countyName(county: string): string {
  return county === "Grad Zagreb" ? county : `${county} županija`;
}

/** A place that could not be found (not a procedure): the place's own not_found sentence. */
export function placeNotFound(text: string): boolean {
  return text.includes("Mjesto nije pronađeno");
}

const VISITS = ["prvi pregled", "kontrolni pregled", "konzultacija bez pacijenta", "ostali postupci"];

/**
 * CEZIH names join the specialty, the subspecialty and the kind of visit with hyphens:
 * "Kardiologija - aritmije srca - prvi pregled" -> "Kardiologija · aritmije srca" + "prvi pregled".
 */
export function procedureParts(name: string): { title: string; visit: string | null } {
  const parts = name
    .split(" - ")
    .map((p) => p.trim())
    .filter(Boolean);
  const last = parts.at(-1)?.toLowerCase() ?? "";
  const visit = parts.length > 1 && VISITS.includes(last) ? last : null;
  return { title: (visit ? parts.slice(0, -1) : parts).join(" · "), visit };
}

/** One line for a text field or a page title: "Kardiologija · aritmije srca (prvi pregled)". */
export function procedureLabel(name: string): string {
  const { title, visit } = procedureParts(name);
  return visit ? `${title} (${visit})` : title;
}
