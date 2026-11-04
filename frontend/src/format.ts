const TZ = "Europe/Zagreb";

/** A non-breaking space: between a number and its unit ("69 dana", "341 km", "1,82 €"). */
export const NBSP = "\u00a0";

export const fmt = (n: number | null | undefined, digits = 0): string =>
  n === null || n === undefined
    ? "–"
    : new Intl.NumberFormat("hr-HR", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(n);

export const fmtInt = (n: number | null | undefined): string =>
  n === null || n === undefined ? "–" : new Intl.NumberFormat("hr-HR").format(n);

const MONTHS_GENITIVE = [
  "siječnja",
  "veljače",
  "ožujka",
  "travnja",
  "svibnja",
  "lipnja",
  "srpnja",
  "kolovoza",
  "rujna",
  "listopada",
  "studenoga",
  "prosinca",
];

/** "2026-09" -> "rujna 2026." (the month an HZZO list describes). */
export function monthYear(ym: string | null | undefined): string {
  const [year, month] = (ym ?? "").split("-").map(Number);
  return year && month ? `${MONTHS_GENITIVE[month - 1]} ${year}.` : "";
}

const MONTHS = [
  "siječanj",
  "veljača",
  "ožujak",
  "travanj",
  "svibanj",
  "lipanj",
  "srpanj",
  "kolovoz",
  "rujan",
  "listopad",
  "studeni",
  "prosinac",
];

/** The month a wait of n days from today ends in: "rujan 2027.". */
export function monthAfter(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + Math.round(n));
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}.`;
}

/** Croatian count agreement: 1 dan, 2–4 dana, 5+ dana (21 dan, 12 dana). */
export function plural(n: number, one: string, few: string, many: string): string {
  const d = Math.abs(n) % 10;
  const h = Math.abs(n) % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

export const days = (n: number): string => `${fmtInt(n)}${NBSP}${plural(n, "dan", "dana", "dana")}`;

/** Names as a sentence lists them: „Vinkovci”, „Vinkovci i Ilok”, „Vinkovci, Ilok i Otok”. */
export function namesHr(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} i ${names.at(-1)}` : (names[0] ?? "");
}

/** A count with its word, which agrees like a noun does: „1.500 oglednih”, „2 stvarna”. */
export const agree = (n: number, one: string, few: string, many: string): string =>
  `${fmtInt(n)}${NBSP}${plural(n, one, few, many)}`;

const WEEKDAYS = ["nedjelja", "ponedjeljak", "utorak", "srijeda", "četvrtak", "petak", "subota"];

function zagrebParts(when: string | Date): { y: number; m: number; d: number; wd: number; time: string } | null {
  const date = typeof when === "string" ? new Date(when) : when;
  if (Number.isNaN(date.getTime())) return null;
  const parts: Record<string, string> = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const get = (key: string) => parts[key] ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y: +get("year"), m: +get("month"), d: +get("day"), wd, time: `${get("hour")}:${get("minute")}` };
}

/** "5. siječnja 2027.", with the day held to its month. */
export function dateHr(iso: string | null | undefined): string {
  const p = iso ? zagrebParts(iso) : null;
  return p ? `${p.d}.${NBSP}${MONTHS_GENITIVE[p.m - 1]} ${p.y}.` : "";
}

/**
 * A first free appointment in full: "utorak, 5. siječnja 2027. u 19:00". The date holds together,
 * so a narrow column breaks only after the weekday or before the hour, never leaving the year
 * alone on a line.
 */
export function slotLongHr(iso: string | null | undefined): string {
  const p = iso ? zagrebParts(iso) : null;
  return p ? `${WEEKDAYS[p.wd]}, ${p.d}.${NBSP}${MONTHS_GENITIVE[p.m - 1]}${NBSP}${p.y}. u${NBSP}${p.time}` : "";
}

/** When a list or a source was last read, short: "27. 10. u 22:50". */
export function stampHr(iso: string | null | undefined): string {
  const p = iso ? zagrebParts(iso) : null;
  return p ? `${p.d}.${NBSP}${p.m}. u${NBSP}${p.time}` : "";
}

/** The same with the year: "27. 10. 2026. u 22:50". */
export function stampYearHr(iso: string | null | undefined): string {
  const p = iso ? zagrebParts(iso) : null;
  return p ? `${p.d}.${NBSP}${p.m}.${NBSP}${p.y}. u${NBSP}${p.time}` : "";
}

/** A day of the log or of the snapshots („2026-10-27”): „27. 10.”, with the year „27. 10. 2026.”. */
export function dayHr(day: string, withYear = false): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return withYear ? `${d}.${NBSP}${m}.${NBSP}${y}.` : `${d}.${NBSP}${m}.`;
}

/** A day with its weekday for the transcript's byline, in Zagreb: "srijeda, 28. listopada 2026." */
export function dayLongHr(date: Date = new Date()): string {
  const p = zagrebParts(date);
  return p ? `${WEEKDAYS[p.wd]}, ${p.d}.${NBSP}${MONTHS_GENITIVE[p.m - 1]} ${p.y}.` : "";
}

/** The time of day in Zagreb, as the dates beside it: "10:38". */
export function timeHr(date: Date | number = new Date()): string {
  return zagrebParts(typeof date === "number" ? new Date(date) : date)?.time ?? "";
}

/**
 * Case, marks and spacing aside, for matching what was typed: „cakovec” finds Čakovec, „dakovo”
 * Đakovo (đ is a letter of its own, not d with a mark), „Brufn ” and „brufn” are the same.
 */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("hr")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

/** Croatian alphabetical order, case and marks aside for ties („č” after „c”). */
export const collator = new Intl.Collator("hr", { sensitivity: "base" });

/** "srijeda, …" -> "Srijeda, …" at the start of a line. */
export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("hr-HR") + text.slice(1);
}

export const euro = (n: number | null | undefined): string =>
  n === null || n === undefined ? "–" : `${fmt(n, 2)}${NBSP}€`;

/* ------------------------------------------------------------ telephone numbers */

/**
 * The first number of a source's phone field, as people read it and as a phone dials it:
 * "+385 32 349 214" -> { national: "032 349 214", href: "tel:+38532349214" }; Zagreb reads
 * "01 2367 720". Sources list several numbers with commas, " ili ", " / " or just a second
 * "+385"; the first one is shown, without an extension ("043/279-222 (247)"). Short numbers
 * (112, 194) are dialled as they are. Anything else is not guessed at: null, and the caller
 * shows the source's text as it is (without a link).
 */
export function phoneParts(raw: string | null | undefined): { national: string; href: string } | null {
  const first = (raw ?? "").split(/[,;\n]| ili | \/ |\s(?=\+)/)[0]?.trim() ?? "";
  let digits = first
    .replace(/\(0\)/g, "") // "+385 (0)1 …": the trunk zero written out
    .replace(/\s*\(\d{1,5}\)\s*$/, "") // an extension at the end
    .replace(/[^\d+]/g, "");
  if (digits.startsWith("+385")) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("00385")) digits = `0${digits.slice(5)}`;
  else if (/^385\d{8,9}$/.test(digits)) digits = `0${digits.slice(3)}`;
  if (/^[1-9]\d{2,4}$/.test(digits)) return { national: digits, href: `tel:${digits}` };
  if (!/^0\d{7,9}$/.test(digits)) return null;
  return { national: groupNational(digits), href: `tel:+385${digits.slice(1)}` };
}

/**
 * Area code, then the number in groups that never break apart: "032 349 214", "01 2367 720",
 * "091 350 0705", "0800 1234".
 */
function groupNational(n: string): string {
  const area = n.startsWith("01") ? "01" : n.startsWith("0800") ? "0800" : n.slice(0, 3);
  const rest = n.slice(area.length);
  let groups: string[];
  if (area === "01" && rest.length === 7) groups = [rest.slice(0, 4), rest.slice(4)];
  else if (rest.length === 6 || rest.length === 7) groups = [rest.slice(0, 3), rest.slice(3)];
  else if (rest.length <= 4) groups = [rest];
  else groups = rest.match(/.{1,3}/g) ?? [rest];
  return [area, ...groups].join(NBSP);
}

/* ------------------------------------------------------------ Croatian typesetting */

/** Straight quotes from the sources as Croatian ones: Poliklinika "Medikol" -> Poliklinika „Medikol”. */
function quotesHr(text: string): string {
  return text.replace(/"([^"\n]*)"/g, "„$1”").replace(/“([^”\n]*)”/g, "„$1”");
}

const UNIT =
  "(?:€|%|dan|dana|km|m|h|min|sat|sata|sati|tjedan|tjedna|tjedana|mjesec|mjeseca|mjeseci|godina|godine|mg|ml|ustanova|ustanove|oblik|oblika|lijek|lijeka|lijekova)";

/** The acronyms that name a procedure or an institution's kind and belong to the word after them. */
const HEAD_ACRONYM =
  /(?<![\p{L}\d])(PET\/CT|MR|UZV|CT|RTG|PET|EEG|EKG|EMNG|EMG|ORL|OCT|KBC|KB|OŽB|ŽB|OB|DZ|SB|PB) (?=[\p{L}\d„(])/gu;

/** A word joiner: glues „e-” to „pošta” without a visible or copied character. */
const WJ = "⁠";

/**
 * Non-breaking spaces where Croatian typesetting wants them: after a one-letter word (a, i, o,
 * u, s, k, z, v), between a number and its unit ("69 dana", "1,82 €"), inside a date
 * ("5. siječnja", "27. 10."), and after an acronym that qualifies the next word („MR koljena”,
 * „KB Sveti Duh”: never „… ili MR / zdjelice?”). „e-pošta” never breaks after „e-”.
 */
export function nbspHr(text: string): string {
  return text
    .replace(/(?<=^|[\s(„])([aiouskzvAIOUSKZV]) /g, `$1${NBSP}`)
    .replace(new RegExp(`(\\d) (?=${UNIT}(?![\\p{L}\\d]))`, "gu"), `$1${NBSP}`)
    .replace(/(\d\.) (?=\d|\p{Ll})/gu, `$1${NBSP}`)
    .replace(HEAD_ACRONYM, `$1${NBSP}`)
    .replace(/\b([eE])-(?=pošt)/g, `$1${WJ}-${WJ}`);
}

/** Text from a source or a template, set the Croatian way: „quotes” and non-breaking spaces. */
export function typesetHr(text: string): string {
  return nbspHr(quotesHr(text));
}

/** How long a conversation lasted: „3:12”, „1:02:03”. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
