/**
 * The layout of the scatter chart „Bliže ili ranije?” (WaitScatter): scales, ticks and the
 * placement of the notes, the median's label, the band's name and the frontier's label so that
 * none of them covers a dot, another label or a line. Pure functions of the data and the size.
 */
import { days, fmt, NBSP } from "../../format";
import { BOLD, ITALIC, textWidth } from "../../measure";
import type { WaitOption } from "../../types";
import { type WaitTone, waitTone } from "../../waiting";

export const NEAR_KM = 100;
const DAY_MS = 86_400_000;
const MONTHS_AXIS = ["sij.", "velj.", "ožu.", "tra.", "svi.", "lip.", "srp.", "kol.", "ruj.", "lis.", "stu.", "pro."];
const MONTHS_SPOKEN = ["", "", "dva mjeseca", "tri mjeseca", "četiri mjeseca", "pet mjeseci", "šest mjeseci",
  "sedam mjeseci", "osam mjeseci", "devet mjeseci", "deset mjeseci", "jedanaest mjeseci"];
/** A note without a leader sits this close to its dot (px between the dot's edge and the letters). */
const NEAR_GAP = 6;
/** A leader is drawn at least this long, or not at all (a shorter one reads as a stray dash). */
const LEADER_MIN = 12;
/** The leader starts 2 px off the dot and stops 3 px short of the letters. */
const LEADER_TRIM = 5;

type Kind = "nearest" | "soonest" | "both" | "sooner" | "striking";
/** What leaving a note out costs: the options on the coupons (nearest, soonest, sooner nearby) are
 * the point of the chart and stay; the striking one is the first to go. */
const MISSING: Record<Kind, number> = { both: 1e6, nearest: 1e6, soonest: 1e6, sooner: 1e6, striking: 1e4 };

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
type Segment = [number, number, number, number];
export interface Dot {
  e: WaitOption & { distance_km: number };
  key: string;
  cx: number;
  cy: number;
  tone: WaitTone;
  picked: boolean;
  /** The drawn radius: the ring of a picked option, else the dot. */
  r: number;
}
interface Note {
  key: string;
  anchor: "start" | "end";
  x: number;
  /** The bold lines and the italic lines, each with its baseline. */
  label: { text: string; y: number }[];
  lines: { text: string; y: number }[];
  leader: string | null;
  /** Where the note and its leader lie (labels placed later keep clear of both). */
  box: Box;
  seg: Segment | null;
  /** The note's number when it stands in the key under the plot (a badge on the ring at box). */
  callout: number | null;
  kind: Kind;
  dot: Dot;
}
interface Label {
  x: number;
  y: number;
  text: string;
  anchor: "start" | "end";
}
/** A vertical line a leader may cross but not run along: within `band` px of it, a leader may
 * have at most `along` px. */
interface Guide {
  x: number;
  band: number;
  along: number;
}
/** Everything a note must keep clear of. */
interface Scene {
  dots: Dot[];
  /** Labels no note and no leader may touch. */
  fixed: Box[];
  /** Lines a note must not straddle (the median line as a 6 px strip); a leader may cross them. */
  strips: Box[];
  /** The plot: a note stays inside it. */
  area: Box;
  /** "danas" (the axis: no leader within 8 px of it) and the median line. */
  guides: Guide[];
  /** Lines a note must not sit on (the frontier's steps); a leader may cross them, not follow them. */
  rails: Segment[];
}

/** Tabular figures are as wide as a zero. */
const tabular = (text: string) => text.replace(/\d/g, "0");

/** The calendar day of an ISO timestamp as written in it ("2027-01-05T19:00+01:00" -> 5 Jan). */
function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS : null;
}

export const kmText = (km: number) => `${fmt(km)}${NBSP}km`;

function aboutMonths(waitDays: number): string | null {
  const months = Math.round(waitDays / 30.44);
  if (months < 2) return null;
  if (months < 12) return `oko ${MONTHS_SPOKEN[months]}`;
  return months < 18 ? "oko godinu dana" : "više od godinu i pol";
}

export function waitShort(n: number): string {
  return n <= 0 ? "danas" : n === 1 ? "sutra" : days(n);
}

/** The bold head of a note: the place and the wait („Rijeka, 8 dana”). */
export function noteHead(dot: Dot): { place: string; when: string } {
  return { place: dot.e.settlement ?? dot.e.spoken_name, when: waitShort(dot.e.wait_days) };
}

/** What the note under the bold label says (FT style: the point, then why it matters). */
export function noteLines(kind: Kind, e: Dot["e"], narrow: boolean): string[] {
  const km = e.distance_km;
  const here = km < 2;
  switch (kind) {
    case "both":
      return ["najbliže i najranije"];
    case "nearest":
      if (narrow) return [here ? "u vašem mjestu" : `oko ${kmText(km)}`];
      return [here ? "najbliže, u vašem mjestu" : `najbliže, oko ${kmText(km)}`];
    case "soonest": {
      const far = km >= 60;
      if (narrow) return [far ? `ali ${kmText(km)} daleko` : `oko ${kmText(km)}`];
      return [far ? `najranije, ali ${kmText(km)} daleko` : `najranije, oko ${kmText(km)}`];
    }
    case "sooner":
      return [narrow ? `oko ${kmText(km)}` : `ranije, oko ${kmText(km)}`];
    case "striking": {
      const months = aboutMonths(e.wait_days);
      const first = here ? "u vašem mjestu, a čeka se" : `samo ${kmText(km)}, a čeka se`;
      return months ? [first, months] : [here ? "u vašem mjestu, a dulje od medijana" : `samo ${kmText(km)}, a dulje od medijana`];
    }
  }
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const grow = (b: Box, dx: number, dy = dx): Box => ({ x0: b.x0 - dx, y0: b.y0 - dy, x1: b.x1 + dx, y1: b.y1 + dy });

/** Distance from a point to a box (0 inside it). */
function boxDistance(b: Box, x: number, y: number): number {
  const nx = Math.max(b.x0, Math.min(x, b.x1));
  const ny = Math.max(b.y0, Math.min(y, b.y1));
  return Math.hypot(nx - x, ny - y);
}

/** Distance from a point to a segment (a leader must not run through another dot). */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(ax + t * vx - px, ay + t * vy - py);
}

function segmentsCross(a: Segment, b: Segment): boolean {
  const [x1, y1, x2, y2] = a;
  const [x3, y3, x4, y4] = b;
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (d === 0) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

function segmentHitsBox(ax: number, ay: number, bx: number, by: number, b: Box): boolean {
  const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 3));
  for (let i = 0; i <= steps; i++) {
    const x = ax + ((bx - ax) * i) / steps;
    const y = ay + ((by - ay) * i) / steps;
    if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return true;
  }
  return false;
}

/** How much of a segment runs within `band` px of a vertical line (a leader may cross the median
 * or start at the axis, but not run along either). */
function lengthAlong(seg: Segment, gx: number, band: number): number {
  const [ax, ay, bx, by] = seg;
  const len = Math.hypot(bx - ax, by - ay);
  if (Math.abs(bx - ax) < 1e-6) return Math.abs(ax - gx) <= band ? len : 0;
  const t1 = (gx - band - ax) / (bx - ax);
  const t2 = (gx + band - ax) / (bx - ax);
  const lo = Math.max(0, Math.min(t1, t2));
  const hi = Math.min(1, Math.max(t1, t2));
  return hi > lo ? (hi - lo) * len : 0;
}

/** How much of a leader runs within `band` px of a step of the frontier (sampled every px): a
 * leader that follows a step reads as part of the staircase. */
function lengthNear(seg: Segment, rail: Segment, band: number): number {
  const [ax, ay, bx, by] = seg;
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(len));
  let near = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    if (segmentDistance(ax + (bx - ax) * t, ay + (by - ay) * t, ...rail) < band) near += len / steps;
  }
  return near;
}

interface Candidate {
  box: Box;
  anchor: "start" | "end";
  score: number;
  /** The leader, dot edge to letters, or null when the note sits right by its dot. */
  leader: Segment | null;
  wording: Wording;
}

/** One way to word a note, and what choosing it costs against the full wording. */
interface Wording {
  /** Bold lines (the place and the wait), then the italic comment under them. */
  label: string[];
  lines: string[];
  cost: number;
  /** How many ordinary dots it may cover (only the last resort may). */
  cover: number;
  /** A longer leader is allowed (the last resort for an option on a coupon). */
  far?: boolean;
  /** A numbered badge on the ring, the note itself in the key under the plot. */
  callout?: boolean;
  /** The label size (a badge's radius follows it). */
  fs?: number;
}

/** The size of a note, and where its letters are inside the box (the box keeps the line height,
 * the letters start under the cap line and end at the descenders). */
interface NoteSize {
  w: number;
  h: number;
  inkTop: number;
  inkBottom: number;
}

/** Line metrics of a note: bold lines at 1.18 of the label size after the first, italic lines
 * at 1.25 of theirs. */
function noteMetrics(fs: number, fsNote: number) {
  const first = fs * 0.98;
  const bold = fs * 1.18;
  const italic = fsNote * 1.25;
  return {
    labelY: (i: number) => first + i * bold,
    lineY: (nb: number, j: number) => first + (nb - 1) * bold + fs * 0.32 + fsNote * (0.98 + j * 1.25),
    height: (nb: number, ni: number) => fs * 1.3 + (nb - 1) * bold + ni * italic,
  };
}

/**
 * Where a note can go. Two kinds of place, both inside the plot, covering no dot and no fixed
 * label, on no step of the frontier and across no 6 px strip of the median line: right by its dot,
 * the letters at most 6 px from the dot's edge and nearer to it than to any other dot, so nobody
 * reads the note as another dot's; or further off on a leader of 12 px to about 4 rem, which runs
 * through no other dot, never within 8 px of the axis, not along the median line and not along a
 * step of the frontier. A leader costs more the longer it is (by its square), so a shorter wording
 * near its dot wins over a long line. The best few are kept for the joint search.
 */
function candidatesFor(dot: Dot, wording: Wording, size: NoteSize, scene: Scene, maxLeader: number): Candidate[] {
  const { cost, cover } = wording;
  const { w, h, inkTop, inkBottom } = size;
  const { dots, fixed, strips, area, guides, rails } = scene;
  const r = dot.r;
  const limit = (wording.far ? maxLeader * 3 : maxLeader) + LEADER_TRIM;
  const out: Candidate[] = [];

  const consider = (x0: number, y0: number, withLeader: boolean) => {
    const box = { x0, y0, x1: x0 + w, y1: y0 + h };
    if (box.x0 < area.x0 || box.x1 > area.x1 || box.y0 < area.y0 || box.y1 > area.y1) return;
    const ink = { x0: box.x0, y0: box.y0 + inkTop, x1: box.x1, y1: box.y1 - inkBottom };
    const qx = Math.max(ink.x0, Math.min(dot.cx, ink.x1));
    const qy = Math.max(ink.y0, Math.min(dot.cy, ink.y1));
    const reach = Math.hypot(qx - dot.cx, qy - dot.cy);
    const gap = reach - r;
    if (withLeader ? gap < LEADER_MIN + LEADER_TRIM || gap > limit : gap < 1.5 || gap > NEAR_GAP) return;
    const clear = grow(ink, 4);
    let covered = 0;
    let crowd = 0;
    for (const d of dots) {
      if (d === dot) continue;
      const dist = boxDistance(ink, d.cx, d.cy) - d.r;
      if (dist < 4) {
        if (d.picked) return;
        covered += 1;
      } else if (!withLeader && dist < Math.max(12, gap + 10)) {
        return; // another dot would claim the note
      } else if (dist < 9) {
        crowd += 1;
      }
    }
    if (covered > cover) return;
    if (fixed.some((f) => overlaps(clear, f)) || strips.some((f) => overlaps(clear, f))) return;
    if (rails.some((s) => segmentHitsBox(...s, clear))) return;
    let leader: Segment | null = null;
    if (withLeader) {
      const ux = (qx - dot.cx) / reach;
      const uy = (qy - dot.cy) / reach;
      leader = [dot.cx + ux * (r + 2), dot.cy + uy * (r + 2), qx - ux * 3, qy - uy * 3];
      const seg = leader;
      if (dots.some((d) => d !== dot && segmentDistance(d.cx, d.cy, ...seg) < d.r + 3)) return;
      // Crossing the median takes about 10 px of a leader (more at a slant); running along it or
      // beside the axis, more. Nor may it follow a step of the frontier.
      if (guides.some((g) => lengthAlong(seg, g.x, g.band) > g.along)) return;
      if (rails.some((s) => lengthNear(seg, s, 3) > 12)) return;
      if (fixed.some((f) => segmentHitsBox(...seg, f))) return;
    }
    const left = (box.x0 + box.x1) / 2 < dot.cx - 4;
    const score =
      cost + covered * 120 + crowd * 30 + (left ? 16 : 0) + (withLeader ? 18 + gap + (gap * gap) / 55 : gap);
    out.push({ box, anchor: left ? "end" : "start", leader, wording, score });
  };

  if (wording.callout) return badgesFor(dot, wording, scene);
  // Right by the dot: a fine grid round it.
  for (let y0 = dot.cy - h - r - NEAR_GAP; y0 <= dot.cy + r + NEAR_GAP; y0 += 2) {
    for (let x0 = dot.cx - w - r - NEAR_GAP; x0 <= dot.cx + r + NEAR_GAP; x0 += 2) consider(x0, y0, false);
  }
  // On a leader: a coarser grid out to the longest leader allowed.
  for (let y0 = dot.cy - h - limit - r; y0 <= dot.cy + limit + r; y0 += 6) {
    for (let x0 = dot.cx - w - limit - r; x0 <= dot.cx + limit + r; x0 += 6) consider(x0, y0, true);
  }
  return diverse(out, 40);
}

/** The radius of a numbered badge for a label size. */
const badgeRadius = (fs: number) => fs * 0.62;

/**
 * Where a crowded corner leaves no room for words: a numbered badge on the ring itself, at one of
 * eight places round it (upper right first), its note in the key under the plot. It may cover an
 * ordinary dot's edge (it is drawn on paper with an ink rim), never another ring or a note.
 */
function badgesFor(dot: Dot, wording: Wording, scene: Scene): Candidate[] {
  const br = badgeRadius(wording.fs ?? 14);
  const out: Candidate[] = [];
  const reach = dot.r + br - 3;
  for (let k = 0; k < 8; k++) {
    const a = -Math.PI / 4 - (k * Math.PI) / 4;
    const cx = dot.cx + Math.cos(a) * reach;
    const cy = dot.cy + Math.sin(a) * reach;
    const box = { x0: cx - br, y0: cy - br, x1: cx + br, y1: cy + br };
    if (box.x0 < scene.area.x0 - br || box.x1 > scene.area.x1 || box.y0 < scene.area.y0 || box.y1 > scene.area.y1 + br) continue;
    let covered = 0;
    let blocked = false;
    for (const d of scene.dots) {
      if (d === dot || Math.hypot(d.cx - cx, d.cy - cy) >= br + d.r) continue;
      if (d.picked) blocked = true;
      covered += 1;
    }
    if (blocked || scene.fixed.some((f) => overlaps(box, f))) continue;
    out.push({ box, anchor: "start", leader: null, wording, score: wording.cost + covered * 60 + k * 4 });
  }
  return out;
}

/** The best candidates, but no two within 16 px of each other: the joint search needs real
 * alternatives, not forty copies of one spot shifted by a few pixels. */
function diverse(cands: Candidate[], limit: number): Candidate[] {
  const kept: Candidate[] = [];
  for (const c of [...cands].sort((a, b) => a.score - b.score)) {
    const near = (k: Candidate) => Math.abs(k.box.x0 - c.box.x0) < 16 && Math.abs(k.box.y0 - c.box.y0) < 16;
    if (kept.some((k) => near(k) && k.wording === c.wording && !k.leader === !c.leader)) continue;
    kept.push(c);
    if (kept.length === limit) break;
  }
  return kept;
}

/**
 * The collision avoider for the notes: the notes are placed together, so the first one cannot take
 * the only free spot of the next. A small depth-first search over each note's best candidates keeps
 * the combination with no two notes or leaders crossing and the shortest leaders. Where a corner is
 * too crowded for words, an option on a coupon gets a number by its ring and its note goes to the
 * key under the plot; only the striking note is ever left out.
 */
function placeNotes(
  drafts: { dot: Dot; kind: Kind; wordings: Wording[] }[],
  scene: Scene,
  fs: number,
  fsNote: number,
  maxLeader: number,
): Note[] {
  const m = noteMetrics(fs, fsNote);
  const options = drafts.map(({ dot, wordings }) =>
    diverse(
      wordings.flatMap((wording) => {
        const w = Math.max(
          0,
          ...wording.label.map((l) => textWidth(l, fs, BOLD)),
          ...wording.lines.map((l) => textWidth(l, fsNote, ITALIC)),
        );
        const size: NoteSize = {
          w: w + 2,
          h: m.height(wording.label.length, wording.lines.length),
          inkTop: fs * 0.26,
          inkBottom: wording.lines.length ? fsNote * 0.05 : fs * 0.12,
        };
        return candidatesFor(dot, wording, size, scene, maxLeader);
      }),
      48,
    ),
  );
  let best: { score: number; pick: (Candidate | null)[] } = { score: Infinity, pick: [] };
  const chosen: (Candidate | null)[] = [];
  const clash = (a: Candidate, b: Candidate) => {
    if (overlaps(grow(a.box, 8, 5), b.box)) return true;
    if (a.leader && segmentHitsBox(...a.leader, b.box)) return true;
    if (a.leader && b.leader && segmentsCross(a.leader, b.leader)) return true;
    return Boolean(b.leader && segmentHitsBox(...b.leader, a.box));
  };
  const search = (i: number, score: number) => {
    if (score >= best.score) return;
    if (i === options.length) {
      best = { score, pick: [...chosen] };
      return;
    }
    for (const c of options[i] ?? []) {
      if (chosen.some((o) => o && clash(o, c))) continue;
      chosen.push(c);
      search(i + 1, score + c.score);
      chosen.pop();
    }
    chosen.push(null);
    search(i + 1, score + MISSING[drafts[i]?.kind ?? "striking"]);
    chosen.pop();
  };
  search(0, 0);

  const out: Note[] = [];
  let numbered = 0;
  best.pick.forEach((c, i) => {
    const draft = drafts[i];
    if (!c || !draft) return;
    const { wording } = c;
    // Numbers in the order of the drafts: 1, 2 (each one figure wide, as measured).
    const callout = wording.callout ? ++numbered : null;
    const leader = c.leader
      ? `M${c.leader[0].toFixed(1)},${c.leader[1].toFixed(1)} L${c.leader[2].toFixed(1)},${c.leader[3].toFixed(1)}`
      : null;
    out.push({
      key: draft.dot.key,
      anchor: c.anchor,
      x: c.anchor === "end" ? c.box.x1 - 1 : c.box.x0 + 1,
      label: wording.label.map((text, k) => ({ text, y: c.box.y0 + m.labelY(k) })),
      lines: wording.lines.map((text, k) => ({ text, y: c.box.y0 + m.lineY(wording.label.length, k) })),
      leader,
      box: c.box,
      seg: c.leader,
      callout,
      kind: draft.kind,
      dot: draft.dot,
    });
  });
  return out;
}

/** What a label placed after the notes keeps clear of: boxes and lines. */
interface Obstacles {
  boxes: Box[];
  segs: Segment[];
}

/**
 * A place for the name of the "do 100 km" band: the leftmost spot (from `from`, up to `until`) on
 * one of the given baselines inside the band that no dot covers, the median line does not cross
 * and no label, note, leader or step of the frontier touches. The top line (under the band's edge)
 * is worth eight letters of moving right, and the long wording may sit four letters further right
 * than the short.
 */
function placeBandLabel(
  texts: string[],
  from: number,
  until: number,
  right: number,
  rows: number[],
  fs: number,
  dots: Dot[],
  medianX: number | null,
  avoid: Obstacles,
): { lx: number; ly: number; text: string; box: Box } | null {
  let best: { lx: number; ly: number; text: string; box: Box; score: number } | null = null;
  for (const [r, ly] of rows.entries()) {
    for (const [i, text] of texts.entries()) {
      const w = textWidth(text, fs, { weight: 650 });
      for (let lx = from; lx <= until && lx + w <= right; lx += 4) {
        const box = { x0: lx - 3, y0: ly - fs * 0.85, x1: lx + w + 3, y1: ly + fs * 0.3 };
        if (dots.some((d) => boxDistance(box, d.cx, d.cy) < d.r + 2)) continue;
        if (medianX !== null && box.x0 < medianX + 2 && medianX - 2 < box.x1) continue;
        if (avoid.boxes.some((b) => overlaps(box, b))) continue;
        if (avoid.segs.some((s) => segmentHitsBox(...s, box))) continue;
        const score = lx - from + i * fs * 4 + r * fs * 8;
        if (!best || score < best.score) best = { lx, ly, text, box, score };
        break;
      }
    }
  }
  return best;
}

/**
 * The frontier („Bliže ili ranije?”): the institutions no other one beats on both counts, nothing
 * both closer and sooner. Sorted by date, each next one is closer than all before it; the staircase
 * from the soonest down to the nearest says how close one can get by waiting until a date. Computed
 * from the dots alone, no new data.
 */
function frontierOf(dots: Dot[]): Dot[] {
  const front: Dot[] = [];
  let best = Number.POSITIVE_INFINITY;
  const byDate = [...dots].sort((a, b) => a.e.wait_days - b.e.wait_days || a.e.distance_km - b.e.distance_km);
  for (const d of byDate) {
    if (d.e.distance_km < best) {
      front.push(d);
      best = d.e.distance_km;
    }
  }
  return front;
}

/** The frontier as steps: right at the level of one institution, then down to the next. */
function frontierSegments(front: Dot[]): Segment[] {
  const segs: Segment[] = [];
  for (let i = 1; i < front.length; i++) {
    const a = front[i - 1];
    const b = front[i];
    if (!a || !b) continue;
    if (b.cx > a.cx) segs.push([a.cx, a.cy, b.cx, a.cy]);
    segs.push([b.cx, a.cy, b.cx, b.cy]);
  }
  return segs;
}

/** The steps that are drawn: none within 6 px of the axis, where institutions with a slot in the
 * first days sit on "danas" and the axis already draws that edge (a second line beside it would
 * read as a doubled axis). */
function drawnSteps(segs: Segment[], axisX: number): Segment[] {
  return segs.filter(([ax, , bx]) => Math.max(ax, bx) >= axisX + 6);
}

/** The steps as one path, a new stroke only where a step was left out. */
function stepsPath(segs: Segment[]): string | null {
  let d = "";
  let end: [number, number] | null = null;
  for (const [ax, ay, bx, by] of segs) {
    if (!end || Math.abs(end[0] - ax) > 0.5 || Math.abs(end[1] - ay) > 0.5) d += `M${ax.toFixed(1)},${ay.toFixed(1)} `;
    d += `L${bx.toFixed(1)},${by.toFixed(1)} `;
    end = [bx, by];
  }
  return d ? d.trim() : null;
}

/**
 * The frontier's name, in the italic of the notes, beside one of its steps: above or under a
 * level stretch, or beside a drop, wherever it touches no dot, note, leader or label. Left out
 * when there is no such place (the credit says what the line is).
 */
function placeFrontierLabel(
  texts: string[],
  segs: Segment[],
  fsNote: number,
  dots: Dot[],
  area: Box,
  avoid: Obstacles,
): (Label & { box: Box }) | null {
  // Set inside tryAt: typed by a cast, so TypeScript does not narrow it to null after the loops.
  let best = null as (Label & { box: Box; score: number }) | null;
  const asc = fsNote * 0.78;
  const desc = fsNote * 0.24;
  for (const [t, text] of texts.entries()) {
    const w = textWidth(text, fsNote, ITALIC);
    const tryAt = (x: number, y: number, anchor: "start" | "end", score: number) => {
      if (best && score >= best.score) return;
      const x0 = anchor === "start" ? x : x - w;
      const box = { x0: x0 - 2, y0: y - asc - 2, x1: x0 + w + 2, y1: y + desc + 2 };
      if (box.x0 < area.x0 || box.x1 > area.x1 || box.y0 < area.y0 || box.y1 > area.y1) return;
      if (dots.some((d) => boxDistance(box, d.cx, d.cy) < d.r + 3)) return;
      if (avoid.boxes.some((b) => overlaps(box, b))) return;
      if (avoid.segs.some((s) => segmentHitsBox(...s, box))) return;
      if (segs.some((s) => segmentHitsBox(...s, box))) return;
      best = { x, y, text, anchor, box, score };
    };
    for (const [i, [ax, ay, bx, by]] of segs.entries()) {
      const order = i * 6 + t * 400;
      if (ay === by) {
        // A level stretch: above it, else under it, from just after the dot onwards.
        for (let x = ax + 14; x + w <= bx - 8; x += 6) {
          tryAt(x, ay - desc - 4, "start", order + (x - ax) * 0.2);
          tryAt(x, ay + asc + 4, "start", order + 40 + (x - ax) * 0.2);
        }
      } else {
        // A drop: beside it, right of it first.
        for (let y = ay + asc + 6; y <= by - 10; y += 6) {
          tryAt(ax + 6, y, "start", order + 60 + (y - ay) * 0.2);
          tryAt(ax - 6, y, "end", order + 90 + (y - ay) * 0.2);
        }
      }
    }
  }
  if (!best) return null;
  const { x, y, text, anchor, box } = best;
  return { x, y, text, anchor, box };
}

/** Month starts (or weeks for a short range) along the time axis, with labels thinned so they
 * never touch: January always carries the year. */
function timeTicks(today: number, xMax: number) {
  const ticks: { at: number; text: string; strong: boolean; slot: number }[] = [];
  if (xMax < 60) {
    for (let at = 7; at <= xMax; at += 7) {
      const d = new Date((today + at) * DAY_MS);
      ticks.push({ at, text: `${d.getUTCDate()}.${NBSP}${d.getUTCMonth() + 1}.`, strong: false, slot: at / 7 });
    }
    return ticks;
  }
  const start = new Date(today * DAY_MS);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + 1;
  for (;;) {
    if (m === 12) {
      m = 0;
      y += 1;
    }
    const at = Date.UTC(y, m, 1) / DAY_MS - today;
    if (at > xMax) break;
    ticks.push({ at, text: `${MONTHS_AXIS[m] ?? ""}${m === 0 ? ` ${y}.` : ""}`, strong: m === 0, slot: m });
    m += 1;
  }
  return ticks;
}

/** A line of text in the chart sits on the band's tint (its halo takes the tint, not the paper). */
export function inBand(baseline: number, size: number, bandY: number | null): boolean {
  return bandY !== null && baseline - size * 0.8 >= bandY - 1;
}

/**
 * Everything the chart draws, for its width and the page's text size: the scales and ticks, the
 * dots, the notes with their leaders, the median, the 100 km band and the frontier. A pure function
 * of its inputs (WaitScatter keeps it for as long as they stay the same).
 */
export function layoutScatter({
  located,
  picked,
  mid,
  origin,
  width,
  root,
}: {
  /** The institutions with a known distance. */
  located: Dot["e"][];
  /** The answer's options (their roles decide the rings and the notes). */
  picked: WaitOption[];
  /** The Croatian median, or the dots' own. */
  mid: number;
  /** The place the distances are from. */
  origin: string;
  width: number;
  /** The root font size in px (A, A+, A++). */
  root: number;
}) {
  const fs = root * 0.78;
  const fsNote = root * 0.78 * 1.07;
  const narrow = width < 480;
  // About 4 rem: a longer leader would carry the eye away from the dot.
  const maxLeader = root * 4;

  // Today as the data sees it (first slot minus the days to it), so the axis matches the waits.
  const first = located.find((e) => dayNumber(e.first_slot) !== null);
  const today = first ? (dayNumber(first.first_slot) ?? 0) - first.wait_days : null;
  const maxWait = Math.max(mid, ...located.map((e) => e.wait_days));
  const xMax = Math.max(21, Math.ceil(maxWait * 1.04 + 4));
  const maxKm = Math.max(10, ...located.map((e) => e.distance_km));
  const yStep = [10, 20, 25, 50, 100, 200, 250].find((s) => s >= maxKm / 4.2) ?? 250;
  const yMax = Math.ceil((maxKm * 1.02) / yStep) * yStep;

  // The unit: "400 km" on the top tick under the word "udaljenost"; on a narrow chart the
  // ticks are bare numbers and "km" stands above them, which gives the dots the width.
  const topLabel = narrow ? fmt(yMax) : `${fmt(yMax)}${NBSP}km`;
  const axisWord = narrow ? "km" : "udaljenost";
  const ml = Math.ceil(Math.max(textWidth(tabular(topLabel), fs), textWidth(axisWord, fs)) + 9);
  const mr = narrow ? 6 : 12;
  const labelY = Math.round(fs * 1.5);
  const mt = labelY + Math.round(fs * 1.25);
  const mb = Math.round(fs * 1.5 + 8);
  const height = narrow
    ? Math.round(Math.max(width * 1.12, mt + mb + fs * 19))
    : Math.round(Math.min(Math.max(width * 0.48, mt + mb + fs * 16), mt + mb + fs * 28));
  const plotW = Math.max(40, width - ml - mr);
  const plotH = height - mt - mb;
  const baseY = mt + plotH;
  const x = (d: number) => ml + (d / xMax) * plotW;
  const y = (km: number) => baseY - (km / yMax) * plotH;

  const yTicks: { v: number; y: number; text: string }[] = [];
  for (let v = 0; v <= yMax + 0.001; v += yStep) {
    yTicks.push({ v, y: y(v), text: v === yMax ? topLabel : fmt(v) });
  }

  // Dots: picked options last (on top), with their role.
  const roleByKey = new Map(picked.map((p) => [`${p.institution}|${p.first_slot}`, p.role]));
  const dots: Dot[] = located
    .map((e) => {
      const key = `${e.institution}|${e.first_slot}`;
      const role = roleByKey.get(key);
      const isPicked = role === "nearest" || role === "soonest_croatia" || role === "sooner_nearby";
      return {
        e,
        key,
        cx: x(e.wait_days),
        cy: y(e.distance_km),
        tone: waitTone(e.wait_days, mid),
        picked: isPicked,
        r: isPicked ? 11 : 5.5,
      };
    })
    .sort((a, b) => Number(a.picked) - Number(b.picked));

  // Time labels sit just right of their tick, in the month they name, low enough under the axis
  // that the ring of an option on the baseline ("u vašem mjestu", 0 km) clears their capitals:
  // a label never has to leave its tick. Then the smallest step, aligned to January, whose
  // labels do not touch.
  const tickY = baseY + 7 + fs * 1.14;
  const ticks = (today === null ? [] : timeTicks(today, xMax)).map((t) => ({
    ...t,
    x: x(t.at),
    lx: x(t.at) + 3,
    w: textWidth(t.text, fs, { weight: t.strong ? 700 : 400 }),
  }));
  let shown = new Set<number>();
  for (const step of [1, 2, 3, 4, 6, 12]) {
    const wanted = ticks.filter((t) => t.slot % step === 0 && t.lx + t.w <= width - 1);
    // January first (it carries the year), then the others from the left, each only where it
    // touches nothing already placed. At a step of one or two months one label may drop out
    // (the one after the wide „sij. 2027.”); a coarser step must keep every label, or the gaps
    // of the axis would read as uneven.
    const placed: typeof ticks = [];
    for (const t of [...wanted.filter((w) => w.strong), ...wanted.filter((w) => !w.strong)]) {
      if (placed.every((o) => o.lx + o.w + fs * 0.7 <= t.lx || t.lx + t.w + fs * 0.7 <= o.lx)) placed.push(t);
    }
    if (wanted.length - placed.length <= (step <= 2 ? 1 : 0)) {
      shown = new Set(placed.map((t) => t.at));
      break;
    }
  }
  const xTicks = ticks.map((t) => ({ x: t.x, lx: t.lx, text: shown.has(t.at) ? t.text : null, strong: t.strong }));

  const medianX = mid > 0 && mid <= xMax ? x(mid) : null;
  const fixed: Box[] = [];
  const today0: Label = { x: ml + 5, y: labelY, text: "danas", anchor: "start" };
  const todayEnd = today0.x + textWidth(today0.text, fs);
  // The median's label: on the top line right of its line, else left of it, else inside the
  // plot beside the line's top, on the first line down that no dot is under; the long wording
  // first (with its number), then the short one. It never runs off the chart or into "danas".
  let medianLabel: Label | null = null;
  if (medianX !== null) {
    const texts = narrow ? [`medijan ${days(mid)}`, "medijan"] : [`medijan u Hrvatskoj: ${days(mid)}`, `medijan ${days(mid)}`];
    const rows = [0, 1, 2, 3].map((k) => mt + fs * (1.15 + k * 1.3));
    search: for (const text of texts) {
      const w = textWidth(text, fs);
      for (const at of [
        { x: medianX + 6, y: labelY, anchor: "start" as const },
        { x: medianX - 6, y: labelY, anchor: "end" as const },
        ...rows.flatMap((y) => [
          { x: medianX + 6, y, anchor: "start" as const },
          { x: medianX - 6, y, anchor: "end" as const },
        ]),
      ]) {
        const x0 = at.anchor === "start" ? at.x : at.x - w;
        if (x0 + w > width - 1 || x0 < (at.y === labelY ? todayEnd + fs * 0.7 : ml + 4)) continue;
        const box = { x0: x0 - 4, y0: at.y - fs * 0.9, x1: x0 + w + 4, y1: at.y + fs * 0.35 };
        if (at.y !== labelY && dots.some((d) => boxDistance(box, d.cx, d.cy) < d.r + 1)) continue;
        medianLabel = { ...at, text };
        if (at.y !== labelY) fixed.push(box);
        break search;
      }
    }
  }
  // The median line itself: a 6 px strip no note may straddle.
  const strips: Box[] = medianX !== null && medianLabel ? [{ x0: medianX - 3, y0: mt - 4, x1: medianX + 3, y1: baseY }] : [];
  const axisLabel: Label = { x: ml - 8, y: labelY, text: axisWord, anchor: "end" };

  // The frontier: drawn under the dots (but not along the axis); notes keep off its steps.
  const front = frontierOf(dots);
  const rails = drawnSteps(front.length > 1 ? frontierSegments(front) : [], ml);
  const frontPath = stepsPath(rails);

  const bandY = y(NEAR_KM);
  const hasBand = yMax > NEAR_KM;
  const bandFrom = ml + fs * 0.5;
  const bandTexts = narrow
    ? [`do ${NEAR_KM}${NBSP}km`]
    : [`do ${NEAR_KM}${NBSP}km od mjesta ${origin}`, `do ${NEAR_KM}${NBSP}km`];
  const bandRight = ml + plotW - fs * 0.5;
  const bandRows: number[] = [];
  for (let ly = bandY + fs * 1.25; ly <= baseY - fs * 0.6; ly += fs * 1.4) bandRows.push(ly);

  // Notes: nearest, soonest (one note when they are the same) or an earlier one nearby, and on
  // a wide chart one striking point: inside 100 km but longer than the median.
  const byRole = (role: WaitOption["role"]) => {
    const p = picked.find((o) => o.role === role);
    return p ? dots.find((d) => d.key === `${p.institution}|${p.first_slot}`) : undefined;
  };
  const nearest = byRole("nearest");
  const soonest = byRole("soonest_croatia");
  const sooner = byRole("sooner_nearby");
  const kinds: [Kind, Dot][] = [];
  if (nearest && nearest.key === soonest?.key) kinds.push(["both", nearest]);
  else {
    if (nearest) kinds.push(["nearest", nearest]);
    if (soonest) kinds.push(["soonest", soonest]);
  }
  // The answer has either a sooner option nearby or the soonest in Croatia: both are coupons, so
  // both keep their note on a narrow chart too.
  if (sooner && !kinds.some(([, d]) => d.key === sooner.key)) kinds.push(["sooner", sooner]);
  if (!narrow && kinds.length < 3) {
    const striking = dots
      .filter((d) => !d.picked && d.tone === "long" && d.e.distance_km <= NEAR_KM)
      .sort((a, b) => a.e.distance_km - b.e.distance_km || b.e.wait_days - a.e.wait_days)[0];
    if (striking) kinds.push(["striking", striking]);
  }
  const drafts = kinds.map(([kind, dot]) => {
    const { place, when } = noteHead(dot);
    const head = `${place}, ${when}`;
    const comment = noteLines(kind, dot.e, narrow);
    // A name of several words may break over two bold lines („Krapinske / Toplice, sutra”).
    const words = place.split(" ");
    const cut = Math.ceil(words.length / 2);
    const first = words.slice(0, cut).join(" ");
    const rest = words.slice(cut).join(" ");
    const wordings: Wording[] = [
      { label: [head], lines: comment, cost: 0, cover: 0 },
      ...(rest ? [{ label: [first, `${rest}, ${when}`], lines: comment, cost: 30, cover: 0 }] : []),
      { label: [place], lines: [when], cost: 70, cover: 0 },
      ...(rest ? [{ label: [first, rest], lines: [when], cost: 90, cover: 0 }] : []),
      { label: [head], lines: [], cost: 150, cover: 0 },
    ];
    // An option on a coupon is never dropped: in a corner too crowded for words it gets a
    // numbered badge on its ring (its note in the key under the plot); a long leader is the
    // very last resort.
    if (kind !== "striking") {
      wordings.push(
        { label: [], lines: [], cost: 400, cover: 0, callout: true, fs },
        { label: [place], lines: [when], cost: 900, cover: 1, far: true },
        { label: [head], lines: [], cost: 950, cover: 1, far: true },
      );
    }
    return { dot, kind, wordings };
  });
  const area = { x0: ml + 6, y0: mt - 2, x1: ml + plotW, y1: baseY - 3 };
  const guides: Guide[] = [{ x: ml, band: 8, along: 8 }];
  if (medianX !== null && medianLabel) guides.push({ x: medianX, band: 5, along: 16 });
  const scene: Scene = { dots, fixed, strips, area, guides, rails };
  const notes = placeNotes(drafts, scene, fs, fsNote, maxLeader);
  const noteBoxes = notes.map((n) => n.box);
  const noteSegs = notes.flatMap((n) => (n.seg ? [n.seg] : []));
  // The band's name after the notes (they matter more): the left third of its top line when a
  // place there is free, else the first free place inside the band, top line first, else the
  // credit names the band. It keeps a little air from the notes, so it never reads as one.
  const bandAvoid = {
    boxes: [...fixed, ...noteBoxes.map((b) => grow(b, 4, fs * 0.3))],
    segs: [...noteSegs, ...rails],
  };
  const bandLabel = hasBand
    ? (placeBandLabel(bandTexts, bandFrom, bandFrom + plotW * 0.3, bandRight, bandRows.slice(0, 1), fs, dots, medianX, bandAvoid) ??
      placeBandLabel(bandTexts, bandFrom, bandRight, bandRight, bandRows, fs, dots, medianX, bandAvoid))
    : null;
  const frontTexts = narrow ? ["ništa nije i bliže i ranije"] : ["ništa nije i bliže i ranije", "ništa bliže i ranije"];
  const frontLabel = rails.length
    ? placeFrontierLabel(frontTexts, rails, fsNote, dots, area, {
        boxes: [...fixed, ...strips, ...noteBoxes, ...(bandLabel ? [bandLabel.box] : [])],
        segs: noteSegs,
      })
    : null;
  const band = hasBand ? { y0: bandY, label: bandLabel } : null;
  const bandTop = hasBand ? bandY : null;
  // The credit counts the institutions the drawn line touches (those on the axis it leaves out).
  const at = (d: Dot, x: number, y: number) => Math.abs(d.cx - x) < 0.5 && Math.abs(d.cy - y) < 0.5;
  const frontCount = front.filter((d) => rails.some(([ax, ay, bx, by]) => at(d, ax, ay) || at(d, bx, by))).length;

  return {
    width, height, ml, mt, plotW, baseY, tickY, narrow, fs, fsNote, labelY,
    yTicks, xTicks, band, bandTop, today0, medianX, medianLabel, axisLabel, dots, notes,
    frontPath, frontLabel, frontCount,
  };
}
