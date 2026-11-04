/** What /termini searches for: the popular searches, and the search as the URL keeps it. */

/** What people look for most, as quiet pills that keep the place. */
export const OFTEN = [
  "MR koljena",
  "UZV abdomena",
  "Kolonoskopija",
  "Mamografija",
  "Kardiologija, prvi pregled",
  "CT mozga",
];

/** "Kardiologija - Prvi pregled", "kardiologija, prvi pregled" and "Kardiologija (prvi pregled)" are one search. */
export const plain = (s: string) =>
  s
    .toLocaleLowerCase("hr")
    .replace(/[-–,()·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export type Params = Record<string, string | undefined>;

export function withParams(current: URLSearchParams, next: Params): URLSearchParams {
  const p = new URLSearchParams(current);
  for (const [k, v] of Object.entries(next)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  return p;
}
