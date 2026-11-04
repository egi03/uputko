/** Dashboard part A: older people and primary care, per municipality (real data only). */
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import {
  type PointerEvent,
  type ReactNode,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { api } from "../../api";
import { Ac } from "../../components/Typeset";
import { agree, fmt, fmtInt, fold, monthYear, namesHr, NBSP, plural } from "../../format";
import { useElementWidth } from "../../hooks/useElementWidth";
import { useFontEpoch } from "../../hooks/useFontEpoch";
import { useRootFontSize } from "../../hooks/useRootFontSize";
import { BOLD, ITALIC, textWidth } from "../../measure";
import type { AccessRow } from "../../types";
import { Busy, Check, Failure, Figure, More, SecHead, Tip } from "./parts";

/* ================================================================== part A: access to care */

interface Average {
  share: number;
  per10k: number;
}

/** The Croatian averages, weighted by population (a municipality of 100 people counts less). */
function average(rows: AccessRow[]): Average {
  let pop65 = 0;
  let old = 0;
  let pop = 0;
  let pzz = 0;
  for (const r of rows) {
    pop += r.population;
    pzz += r.pzz_practices;
    if (r.population_65_plus !== null) {
      pop65 += r.population;
      old += r.population_65_plus;
    }
  }
  return { share: pop65 ? (old / pop65) * 100 : 0, per10k: pop ? (pzz / pop) * 10_000 : 0 };
}

/** More people over 65 and fewer practices than the Croatian average: the finding of part A. */
const isGap = (r: AccessRow, avg: Average) =>
  r.share_65_plus_pct !== null &&
  r.pzz_per_10k !== null &&
  r.share_65_plus_pct > avg.share &&
  r.pzz_per_10k < avg.per10k;

const kindOf = (r: AccessRow) => (r.municipality_type === "Grad" ? "grad" : "općina");

/** One town or municipality, the same in the chart, the table and the hover between them. */
const rowKey = (r: AccessRow) => `${r.county}|${r.municipality}`;

type Tone = "long" | "mid" | "short";

/**
 * A bar is red on the side of the Croatian average that part A is about: more people over 65, fewer
 * practices. The other side is grey for the share and teal for the practices, so a place in the
 * chart's red quarter is the row with two red bars.
 */
const shareTone = (v: number | null, avg: Average): Tone | null => (v === null ? null : v > avg.share ? "long" : "mid");
const pzzTone = (v: number | null, avg: Average): Tone | null => (v === null ? null : v < avg.per10k ? "long" : "short");

interface Filter {
  county: string;
  search: string;
  onlyGap: boolean;
}

const NO_FILTER: Filter = { county: "", search: "", onlyGap: false };

const isFiltered = (f: Filter) => f.county !== "" || f.search.trim() !== "" || f.onlyGap;

function applyFilter(rows: AccessRow[], f: Filter, avg: Average): AccessRow[] {
  const q = fold(f.search.trim());
  return rows.filter(
    (r) =>
      (!f.county || r.county === f.county) && (!q || fold(r.municipality).includes(q)) && (!f.onlyGap || isGap(r, avg)),
  );
}

interface Dot {
  row: AccessRow;
  key: string;
  x: number;
  y: number;
  gap: boolean;
}

interface Note {
  /** The named dot, or null for the note on the column of places without a practice. */
  d: Dot | null;
  key: string;
  x: number;
  anchor: "start" | "end";
  ly: number;
  h: number;
  /** The bold label, in one line or, in a narrow chart, two. */
  lines: string[];
  comment: string | null;
}

/** The places with no contracted practice at all: one column on x = 0, named as one group. */
interface Zeros {
  count: number;
  people: number;
  /** All of them are municipalities (općine), not towns. */
  municipalities: boolean;
}

function zerosOf(rows: AccessRow[]): Zeros {
  const zero = rows.filter((r) => r.share_65_plus_pct !== null && r.pzz_per_10k === 0);
  return {
    count: zero.length,
    people: zero.reduce((n, r) => n + r.population, 0),
    municipalities: zero.every((r) => r.municipality_type !== "Grad"),
  };
}

/** „općina”, „grada ili općine”: the noun that goes with the count. */
const zerosNoun = (z: Zeros) =>
  z.municipalities
    ? plural(z.count, "općina", "općine", "općina")
    : plural(z.count, "grad ili općina", "grada ili općine", "gradova i općina");

/** „51 općina”, „3 grada ili općine”. */
const zerosCount = (z: Zeros) => `${fmtInt(z.count)}${NBSP}${zerosNoun(z)}`;

/** „51 općina bez ijedne ordinacije”, „3 grada ili općine bez ijedne ordinacije”. */
const zerosLabel = (z: Zeros) => `${zerosCount(z)} bez ijedne ordinacije`;

/**
 * The outlier chart (part A): every town and municipality by practices per 10,000 people
 * (x) and the share of people over 65 (y). The dashed lines are the Croatian averages; the
 * quarter with more elderly and fewer practices is red, the rest grey. Its strongest fact is the
 * column on x = 0, the places without a single practice: a bracket names them as one group, and
 * the most elderly place of the red quarter is named on its own. It follows the table below: the
 * places its filter leaves keep their colour and the others fade (one to three of them are named
 * beside their dots), and the row under the pointer rings its dot. Drawn 1 unit = 1 px, text from
 * the root size (A / A+ / A++).
 */
function OutlierChart({
  rows,
  avg,
  gapCount,
  marked,
  hotKey,
}: {
  rows: AccessRow[];
  avg: Average;
  gapCount: number;
  /** The rows the table's filter leaves, or null when nothing is filtered. */
  marked: AccessRow[] | null;
  /** The table row under the pointer or in focus. */
  hotKey: string | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrapRef, 720);
  const root = useRootFontSize();
  useFontEpoch();
  const [hover, setHover] = useState<string | null>(null);
  const markedKeys = useMemo(() => (marked ? new Set(marked.map(rowKey)) : null), [marked]);

  const fs = root * 0.78;
  const fsNote = root * 0.83;
  const narrow = width < 480;
  const m = { top: fs * 2.6, right: narrow ? 6 : 14, bottom: fs * 3.4, left: fs * 3.2 };
  const height = Math.round(narrow ? Math.max(root * 17, width * 1.02) : Math.min(width * 0.6, root * 29));
  const plotW = Math.max(10, width - m.left - m.right);
  const plotH = Math.max(10, height - m.top - m.bottom);

  const valid = rows.filter((r) => r.share_65_plus_pct !== null && r.pzz_per_10k !== null);
  const xMax = Math.max(10, Math.ceil(Math.max(...valid.map((r) => r.pzz_per_10k ?? 0)) / 5) * 5);
  const yMin = Math.floor(Math.min(...valid.map((r) => r.share_65_plus_pct ?? 0)) / 10) * 10;
  const yMax = Math.ceil(Math.max(...valid.map((r) => r.share_65_plus_pct ?? 0)) / 5) * 5;
  const sx = (v: number) => m.left + (v / xMax) * plotW;
  const sy = (v: number) => m.top + plotH - ((v - yMin) / Math.max(1, yMax - yMin)) * plotH;

  const dots: Dot[] = valid.map((row) => ({
    row,
    key: rowKey(row),
    x: sx(row.pzz_per_10k ?? 0),
    y: sy(row.share_65_plus_pct ?? 0),
    gap: isGap(row, avg),
  }));
  const lit = markedKeys ? dots.filter((d) => markedKeys.has(d.key)) : dots;
  const dim = markedKeys ? dots.filter((d) => !markedKeys.has(d.key)) : [];
  // Unfiltered, the column of places without a practice is bracketed and named as one group, and
  // only the most elderly place of the red quarter is named on its own (its neighbours on x = 0
  // would only repeat the bracket). One to three places left by the filter are each named beside
  // their dot; a wider filter names the most elderly of its red quarter.
  const allZeros = zerosOf(valid);
  const zeroDots = markedKeys ? [] : dots.filter((d) => d.row.pzz_per_10k === 0);
  const zeros = zeroDots.length >= 3 ? allZeros : null;
  const few = markedKeys !== null && lit.length > 0 && lit.length <= 3;
  const named = (few ? [...lit] : lit.filter((d) => d.gap))
    .sort((a, b) => a.y - b.y)
    .slice(0, few ? 3 : zeros ? 1 : narrow ? 2 : 3);

  const xStep = narrow ? 10 : 5;
  const xTicks = Array.from({ length: Math.floor(xMax / xStep) + 1 }, (_, i) => i * xStep);
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax; v += 10) yTicks.push(v);

  const ax = sx(avg.per10k);
  const ay = sy(avg.share);

  // Notes for the named points, stacked so none overlaps. The red quarter's notes stand right of
  // the average line, clear of the red cloud; a place found by the filter is named beside its own
  // dot, on the side with room. A comment that does not fit is dropped, and in the quarter's notes
  // a neighbour with the same comment only gets its name. A narrow chart with the bracket packs its
  // two notes from the top of the plot, above the dots right of the average line: the place is
  // named without a comment, the bracket's label takes two lines where one does not fit, and its
  // comment shortens, or goes where it would cover a dot.
  const lineH = fs * 1.28;
  const commentH = fsNote * 1.25;
  const notes: Note[] = [];
  const pack = narrow && zeros !== null;
  const stackTop = pack ? m.top - fs * 0.9 : m.top + fs * 0.9;
  // A line of words from x, w wide, between top and bottom, covers no dot (with a little air).
  const clearOfDots = (x: number, w: number, top: number, bottom: number) =>
    !lit.some((d) => d.x > x - 6 && d.x < x + w + 6 && d.y > top - 5 && d.y < bottom + 5);
  // The most elderly place of all gets that said; others say how many practices they have.
  const oldest = valid.reduce<AccessRow | null>(
    (a, r) => (a && (a.share_65_plus_pct ?? 0) >= (r.share_65_plus_pct ?? 0) ? a : r),
    null,
  );
  for (const d of named) {
    const prev = notes.at(-1);
    const r = d.row;
    const label = `${r.municipality}, ${fmt(r.share_65_plus_pct, 1)}${NBSP}%`;
    const none = r.municipality_type === "Grad" ? "nijedna ordinacija u gradu" : "nijedna ordinacija u općini";
    const text =
      zeros && r === oldest
        ? "najveći udio starijih u Hrvatskoj"
        : r.pzz_practices === 0
          ? none
          : `${fmt(r.pzz_per_10k, 1)} ordinacija na 10.000`;
    const lw = textWidth(label, fs, BOLD);
    const cw = textWidth(text, fsNote, ITALIC);
    let x = few ? d.x + 14 : Math.max(d.x + 16, ax + 12);
    let anchor: "start" | "end" = "start";
    if (few && x + Math.max(lw, cw) > width && d.x - 14 - Math.max(lw, cw) >= 0) {
      x = d.x - 14;
      anchor = "end";
    } else {
      x = Math.min(x, width - lw);
    }
    const room = anchor === "start" ? width - x : x;
    const comment = !pack && cw <= room && (few || !notes.some((n) => n.comment === text)) ? text : null;
    const h = comment ? lineH + commentH : lineH;
    const floor = prev ? prev.ly + prev.h + fs * 0.45 : stackTop;
    const natural = pack ? floor : few ? d.y - lineH * 0.62 : d.y - h / 2 - fs * 0.25;
    notes.push({ d, key: d.key, x, anchor, ly: Math.max(natural, floor), h, lines: [label], comment });
  }
  // The bracket along the column on x = 0, clear of its dots and of a named dot's ring; its note
  // joins the stack right of the average line, and a level leader reaches it from the bracket.
  const bx = sx(0) + 13;
  const zTop = zeroDots.length ? Math.min(...zeroDots.map((d) => d.y)) - 3 : 0;
  const zBot = zeroDots.length ? Math.max(...zeroDots.map((d) => d.y)) + 3 : 0;
  // A packed stack starts the bracket's leader below the ring of a place named on x = 0, so two
  // leaders never leave the same dot.
  const zeroRingLow = Math.max(
    zTop,
    ...notes.filter((n) => n.d?.row.pzz_per_10k === 0).map((n) => (n.d?.y ?? 0) + 12),
  );
  if (zeros) {
    const prev = notes.at(-1);
    const floor = prev ? prev.ly + prev.h + fs * 0.45 : stackTop;
    const x0 = Math.max(bx + 16, ax + 12);
    const count = zerosCount(zeros);
    const variants = [[zerosLabel(zeros)], [count, "bez ijedne ordinacije"], [count, "bez ordinacije"]];
    const widthOf = (lines: string[]) => Math.max(...lines.map((l) => textWidth(l, fs, BOLD)));
    // Right of the average line, in the first form that fits there. Only where none does, the
    // note crosses the line, as far left as the bracket allows, and the notes stacked above it
    // move with it, so the stack keeps one left edge.
    const fitting = variants.find((v) => x0 + widthOf(v) <= width);
    const lines = fitting ?? [count, "bez ordinacije"];
    const x = fitting ? x0 : Math.max(bx + 16, width - widthOf(lines));
    if (x < x0) {
      for (const n of notes) if (n.anchor === "start" && Math.abs(n.x - x0) < 0.5) n.x = x;
    }
    // Level with the upper part of the bracket, so the leader runs straight across to it (a
    // packed note stays at the top of the stack).
    const ly = pack ? floor : Math.min(Math.max(floor, zTop + (zBot - zTop) * 0.12), zBot - lineH);
    const labelH = lines.length * lineH;
    const people = agree(zeros.people, "stanovnik", "stanovnika", "stanovnika");
    const texts = [`u njima ${plural(zeros.people, "živi", "žive", "živi")} ${people}`, people];
    const comment =
      texts.find((t) => {
        const w = textWidth(t, fsNote, ITALIC);
        return x + w <= width && (!pack || clearOfDots(x, w, ly + labelH, ly + labelH + commentH));
      }) ?? null;
    notes.push({ d: null, key: "zeros", x, anchor: "start", ly, h: labelH + (comment ? commentH : 0), lines, comment });
  }
  // The average's label: in full right of its line, shorter where that does not fit, and left of
  // the line only as the last resort.
  const avgFull = `prosjek Hrvatske: ${fmt(avg.per10k, 1)}`;
  const avgShort = `prosjek: ${fmt(avg.per10k, 1)}`;
  const avgLabel = ax + 6 + textWidth(avgFull, fs, BOLD) <= width ? avgFull : avgShort;
  const avgLeft = ax + 6 + textWidth(avgLabel, fs, BOLD) > width;
  // The axis says it in full where it fits, then shorter, and „udio 65+” (the table's word) last.
  const yTitle =
    ["udio stanovnika starijih od 65 godina", "udio starijih od 65 godina"].find(
      (t) => textWidth(t, fs, BOLD) <= width,
    ) ?? "udio 65+";
  const xTitle =
    textWidth("ordinacija na 10.000 stanovnika", fs, BOLD) > plotW
      ? "ordinacija na 10.000"
      : "ordinacija na 10.000 stanovnika";
  const quad = "više starijih, manje ordinacija";
  const showQuad = ax - 8 > textWidth(quad, fs, BOLD);

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    let best: Dot | null = null;
    let bestD = 14 * 14;
    for (const d of dots) {
      const dd = (d.x - px) ** 2 + (d.y - py) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    setHover(best?.key ?? null);
  }

  const shown = hover ? dots.find((d) => d.key === hover) : undefined;
  const hot = hotKey ? dots.find((d) => d.key === hotKey) : undefined;
  const hotNamed = hot ? notes.some((n) => n.key === hot.key) : false;
  const hotRight = hot ? hot.x + 13 + textWidth(hot.row.municipality, fs, BOLD) <= width : true;

  const dot = (d: Dot, cls = "") => (
    <circle
      key={d.key}
      className={`ch__dot ch__dot--${d.gap ? "long" : "mid"}${cls}`}
      cx={d.x}
      cy={d.y}
      r={4}
    />
  );

  return (
    <div className="ochart" ref={wrapRef}>
      <svg
        className="ch ochart__svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Graf odstupanja: ${fmtInt(valid.length)} gradova i općina prema broju ordinacija na 10.000 stanovnika i udjelu stanovnika starijih od 65 godina. ${fmtInt(gapCount)} ih ima više starijih i manje ordinacija od prosjeka Hrvatske.${allZeros.count ? ` ${zerosLabel(allZeros)}; u njima ${plural(allZeros.people, "živi", "žive", "živi")} ${agree(allZeros.people, "stanovnik", "stanovnika", "stanovnika")}.` : ""} Isti podaci su u tablici ispod.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* y grid and ticks; the unit only on the top one */}
        {yTicks.map((v, i) => (
          <g key={v}>
            {i > 0 ? <line className="ch__grid" x1={m.left} x2={m.left + plotW} y1={sy(v)} y2={sy(v)} /> : null}
            <text className="ch__tick" x={m.left - 8} y={sy(v)} dy="0.34em" textAnchor="end" style={{ fontSize: fs }}>
              {i === yTicks.length - 1 ? `${v}${NBSP}%` : v}
            </text>
          </g>
        ))}
        <text className="ch__tick ch__tick--b" x={0} y={m.top - fs * 1.6} style={{ fontSize: fs }}>
          {yTitle}
        </text>
        {/* x ticks and the axis title under them */}
        {xTicks.map((v) => (
          <g key={v}>
            <line className="ch__axis" x1={sx(v)} x2={sx(v)} y1={m.top + plotH} y2={m.top + plotH + 4} />
            <text
              className="ch__tick"
              x={sx(v)}
              y={m.top + plotH + fs * 1.55}
              textAnchor="middle"
              style={{ fontSize: fs }}
            >
              {v}
            </text>
          </g>
        ))}
        <text
          className="ch__tick ch__tick--b"
          x={m.left + plotW}
          y={m.top + plotH + fs * 3.05}
          textAnchor="end"
          style={{ fontSize: fs }}
        >
          {xTitle}
        </text>
        <line className="ch__base" x1={m.left} x2={m.left + plotW} y1={m.top + plotH} y2={m.top + plotH} />

        {/* the Croatian averages */}
        <line className="ch__median" x1={ax} x2={ax} y1={m.top - fs * 0.4} y2={m.top + plotH} />
        <line className="ch__median" x1={m.left} x2={m.left + plotW} y1={ay} y2={ay} />
        {/* the quarter the chart is about, named where it is */}
        {showQuad ? (
          <text
            className="ch__lab ochart__quad"
            x={ax - 8}
            y={m.top + fs * 0.35}
            textAnchor="end"
            style={{ fontSize: fs }}
          >
            {quad}
          </text>
        ) : null}

        <g aria-hidden="true">
          {dim.map((d) => dot(d, " is-dim"))}
          {lit.filter((d) => !d.gap).map((d) => dot(d))}
          {lit.filter((d) => d.gap).map((d) => dot(d))}
          {zeros ? (
            <path
              className="ochart__bracket"
              d={`M${bx - 4},${zTop} H${bx} V${zBot} H${bx - 4}`}
            />
          ) : null}
          {notes.map(({ d, key, x, anchor, ly, lines, comment }) => {
            const side = anchor === "start" ? 1 : -1;
            const ex = x - side * 5;
            const ey = ly + lineH * 0.55;
            // A dot's note is led from the dot's ring; the column's note from its bracket (from
            // within its span, so the leader never starts in the air above it; in a packed stack
            // from below a named dot's ring, see zeroRingLow).
            const from = d
              ? { x: d.x + side * 8, y: d.y }
              : {
                  x: bx,
                  y: pack
                    ? Math.min(zBot, Math.max(zTop + (zBot - zTop) * 0.12, zeroRingLow))
                    : Math.min(Math.max(ey, zTop), zBot),
                };
            const long = Math.hypot(ex - from.x, ey - from.y) > 10;
            return (
              <g key={key}>
                {d ? <circle className="ch__ring" cx={d.x} cy={d.y} r={8} /> : null}
                {long ? <polyline className="ch__leader" points={`${from.x},${from.y} ${ex},${ey}`} /> : null}
                {lines.map((line, i) => (
                  <text
                    key={line}
                    className="ch__lab"
                    x={x}
                    y={ly + fs + i * lineH}
                    textAnchor={anchor}
                    style={{ fontSize: fs }}
                  >
                    {line}
                  </text>
                ))}
                {comment ? (
                  <text
                    className="ch__note"
                    x={x}
                    y={ly + lines.length * lineH + fsNote * 0.95}
                    textAnchor={anchor}
                    style={{ fontSize: fsNote }}
                  >
                    {comment}
                  </text>
                ) : null}
              </g>
            );
          })}
          {/* the table row under the pointer: its dot ringed, and named when it has no note */}
          {hot ? <circle className="ch__ring ch__ring--hover" cx={hot.x} cy={hot.y} r={hotNamed ? 11 : 8} /> : null}
          {hot && !hotNamed ? (
            <text
              className="ch__lab"
              x={hotRight ? hot.x + 13 : hot.x - 13}
              y={hot.y + fs * 0.36}
              textAnchor={hotRight ? "start" : "end"}
              style={{ fontSize: fs }}
            >
              {hot.row.municipality}
            </text>
          ) : null}
          {shown ? <circle className="ch__ring" cx={shown.x} cy={shown.y} r={7} /> : null}
        </g>
        {/* the averages' labels last, on their paper halo above the dots */}
        <text
          className="ch__lab"
          x={avgLeft ? ax - 6 : ax + 6}
          y={m.top + plotH - fs * 0.6}
          textAnchor={avgLeft ? "end" : "start"}
          style={{ fontSize: fs }}
        >
          {avgLabel}
        </text>
        <text className="ch__lab" x={m.left + plotW} y={ay - fs * 0.55} textAnchor="end" style={{ fontSize: fs }}>
          {`prosjek: ${fmt(avg.share, 1)}${NBSP}%`}
        </text>
      </svg>
      {shown ? (
        <Tip x={shown.x} y={shown.y} width={width}>
          <strong>
            {shown.row.municipality} <span className="ochart__kind">({kindOf(shown.row)})</span>
          </strong>
          {shown.row.county}
          <br />
          {`udio 65+: ${fmt(shown.row.share_65_plus_pct, 1)}${NBSP}%`}
          <br />
          {`ordinacija na 10.000: ${fmt(shown.row.pzz_per_10k, 1)}`}
        </Tip>
      ) : null}
    </div>
  );
}

/**
 * One place against the Croatian averages, as the answer to a search: „Vinkovci (grad): udio
 * starijih od 65 godina 20,5 % (prosjek 22,5 %), ordinacija na 10.000 stanovnika 16,2 (prosjek
 * 12,7). Manje starijih i više ordinacija od prosjeka.”
 */
function PlaceAnswer({ r, avg }: { r: AccessRow; avg: Average }) {
  const share = r.share_65_plus_pct;
  const pzz = r.pzz_per_10k;
  const figures = [
    share !== null ? `udio starijih od 65 godina ${fmt(share, 1)}${NBSP}% (prosjek ${fmt(avg.share, 1)}${NBSP}%)` : null,
    pzz !== null ? `ordinacija na 10.000 stanovnika ${fmt(pzz, 1)} (prosjek ${fmt(avg.per10k, 1)})` : null,
  ].filter(Boolean);
  const older = share !== null && share > avg.share;
  const fewer = pzz !== null && pzz < avg.per10k;
  const verdict =
    share === null || pzz === null
      ? null
      : older && fewer
        ? "Više starijih i manje ordinacija od prosjeka."
        : older
          ? "Više starijih od prosjeka, ali i više ordinacija."
          : fewer
            ? "Manje starijih od prosjeka, ali i manje ordinacija."
            : "Manje starijih i više ordinacija od prosjeka.";
  // „Zagreb (grad)”: the City of Zagreb is its own county, which need not be said twice.
  const where = r.county === `Grad ${r.municipality}` ? kindOf(r) : `${kindOf(r)}, ${r.county}`;
  return (
    <>
      <b>{r.municipality}</b> ({where}){figures.length ? `: ${figures.join(", ")}.` : "."}
      {verdict ? ` ${verdict}` : ""}
    </>
  );
}

/** The answer under the place finder: the one place found, or how many the chart now marks. */
function ChartHint({ marked, total, avg }: { marked: AccessRow[] | null; total: number; avg: Average }) {
  if (!marked) return null;
  if (!marked.length) return <>Nijedan grad ili općina ne odgovara upisu.</>;
  const only = marked.length === 1 ? marked[0] : undefined;
  if (only) return <PlaceAnswer r={only} avg={avg} />;
  if (marked.length <= 3) {
    return (
      <>
        <b>Na grafu:</b> {namesHr(marked.map((r) => r.municipality))}.
      </>
    );
  }
  return (
    <>
      <b>Na grafu</b> je istaknuto {fmtInt(marked.length)} od {fmtInt(total)} gradova i&nbsp;općina.
    </>
  );
}

/**
 * „Provjeri mjesto [Vinkovci]”: the one action of part A. What is typed filters the table and marks
 * the place in the chart; one place found is answered in a sentence under the field.
 */
function PlaceFinder({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (text: string) => void;
  /** The answer, read out politely as it changes. */
  children: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="dfind" role="search" aria-label="Provjera grada ili općine">
      <div className="dfind__row">
        <label className="dfind__label" htmlFor="dash-muni">
          Provjeri mjesto
        </label>
        <div className="field dfind__field">
          <input
            id="dash-muni"
            ref={ref}
            type="search"
            autoComplete="off"
            placeholder="npr. Vinkovci"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {/* Its place is kept while the field is empty (hidden, out of the tab order). */}
          <button
            type="button"
            className="dfilter__clear"
            aria-label="Obriši upis"
            hidden={!value}
            onClick={() => {
              onChange("");
              ref.current?.focus();
            }}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="dfind__answer" aria-live="polite">
        {children}
      </p>
    </div>
  );
}

type SortKey = "municipality" | "county" | "population" | "share_65_plus_pct" | "pzz_per_10k" | "gp_per_10k";

/* „na 10.000” stays together, so a narrow header breaks as „Opća medicina / na 10.000”. In a
   narrow column every header is a sort key above the rows (dashboard.css), so all six stay. */
const COLUMNS: { key: SortKey; label: string; cls: string; num?: boolean }[] = [
  { key: "municipality", label: "Grad ili općina", cls: "dtbl__name" },
  { key: "county", label: "Županija", cls: "dtbl__county" },
  { key: "share_65_plus_pct", label: "Udio 65+", cls: "dtbl__share", num: true },
  { key: "pzz_per_10k", label: `Ordinacije na${NBSP}10.000`, cls: "dtbl__pzz", num: true },
  { key: "gp_per_10k", label: `Opća medicina na${NBSP}10.000`, cls: "dtbl__gp", num: true },
  { key: "population", label: "Stanovnika", cls: "dtbl__pop", num: true },
];

/** Rows shown first: fewer in a phone column, where every row is a name over two bars. */
const PAGE = 10;
const PAGE_NARROW = 5;
const MORE = 25;
const MORE_NARROW = 10;

/** A value with its bar and the Croatian average as a tick (the same reading as /termini). */
function CellBar({
  value,
  max,
  mark,
  tone,
  text,
  unit,
}: {
  value: number | null;
  max: number;
  mark: number;
  tone: Tone | null;
  text: string;
  /** Said after the value for a screen reader, which may not get the header in a narrow column. */
  unit: string;
}) {
  const w = value === null ? 0 : Math.min(1, value / max);
  return (
    <span className="cbar">
      <span className="cbar__track" aria-hidden="true">
        {tone ? <span className={`cbar__fill cbar__fill--${tone}`} style={{ width: `${w * 100}%` }} /> : null}
        <span className="cbar__tick" style={{ left: `${Math.min(1, mark / max) * 100}%` }} />
      </span>
      <span className="cbar__n">
        {text}
        <span className="visually-hidden">{` ${unit}`}</span>
      </span>
    </span>
  );
}

/** The table row a pointer or the focus is in, as its key. */
function rowAt(target: EventTarget | null): string | null {
  const tr = target instanceof Element ? target.closest<HTMLElement>("tr[data-key]") : null;
  return tr?.dataset.key ?? null;
}

/**
 * The table of all towns and municipalities: searchable, by county, sortable. The filter
 * lives in part A, so the outlier chart above follows it; the row under the pointer is reported
 * the same way. Memoised: the chart's hover state does not redraw 556 rows.
 */
const AccessTable = memo(function AccessTable({
  rows,
  list,
  counties,
  avg,
  gapCount,
  filter,
  onFilter,
  onHot,
}: {
  rows: AccessRow[];
  /** The rows the filter leaves, in the data's order. */
  list: AccessRow[];
  counties: string[];
  avg: Average;
  gapCount: number;
  filter: Filter;
  onFilter: (patch: Partial<Filter>) => void;
  onHot: (key: string | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrapRef, 1000);
  const root = useRootFontSize();
  const narrow = width <= 30 * root;
  const page = narrow ? PAGE_NARROW : PAGE;
  const step = narrow ? MORE_NARROW : MORE;
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "share_65_plus_pct", desc: true });
  const [extra, setExtra] = useState(0);
  const shown = page + extra;
  const focusRow = useRef<number | null>(null);
  const focusMore = useRef(false);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  // A new search starts the table short again.
  const [seen, setSeen] = useState(filter.search);
  if (seen !== filter.search) {
    setSeen(filter.search);
    setExtra(0);
  }

  const sorted = useMemo(() => {
    const { key, desc } = sort;
    return [...list].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      let cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv, "hr")
          : Number(av ?? -1) - Number(bv ?? -1);
      if (cmp === 0) cmp = (a.share_65_plus_pct ?? 0) - (b.share_65_plus_pct ?? 0);
      return desc ? -cmp : cmp;
    });
  }, [list, sort]);

  // „Prikaži još” moves focus to the first new row; „Prikaži manje” to „Prikaži još” at the end
  // of the short table, which scrolls it back into view.
  useEffect(() => {
    if (focusMore.current) {
      focusMore.current = false;
      moreRef.current?.focus();
      return;
    }
    if (focusRow.current === null) return;
    const th = bodyRef.current?.rows[focusRow.current]?.querySelector<HTMLElement>("th");
    focusRow.current = null;
    th?.focus();
  }, [shown]);

  const maxShare = Math.max(1, ...rows.map((r) => r.share_65_plus_pct ?? 0));
  const maxPzz = Math.max(1, ...rows.map((r) => r.pzz_per_10k ?? 0));

  function update(patch: Partial<Filter>) {
    setExtra(0);
    onFilter(patch);
  }
  function toggle(key: SortKey) {
    setExtra(0);
    setSort((s) =>
      s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "municipality" && key !== "county" },
    );
  }
  function more(n: number) {
    focusRow.current = shown;
    setExtra((e) => e + n);
  }
  function less() {
    focusMore.current = true;
    setExtra(0);
  }

  const active = COLUMNS.find((c) => c.key === sort.key);
  const rest = sorted.length - shown;

  return (
    <div className="dstock" ref={wrapRef}>
      <div className="dstock__head">
        <h3>Svi gradovi i&nbsp;općine</h3>
        {/* As wide as its widest reading („556 od 556”) whatever it says, so the row stands still. */}
        <p className="dfilter__count">
          <span className="dfilter__ghost" aria-hidden="true">
            <b>{fmtInt(rows.length)}</b> od {fmtInt(rows.length)}
          </span>
          <span aria-live="polite">
            <b>{fmtInt(sorted.length)}</b> od {fmtInt(rows.length)}
            <span className="visually-hidden"> gradova i&nbsp;općina</span>
          </span>
        </p>
      </div>
      <div className="dfilter" role="group" aria-label="Filtriranje tablice gradova i općina">
        <label className="visually-hidden" htmlFor="dash-county">
          Županija
        </label>
        <select
          id="dash-county"
          className="select dfilter__county"
          value={filter.county}
          onChange={(e) => update({ county: e.target.value })}
        >
          <option value="">Sve županije</option>
          {counties.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Check checked={filter.onlyGap} onChange={(on) => update({ onlyGap: on })}>
          Više starijih, manje ordinacija ({fmtInt(gapCount)})
        </Check>
      </div>
      <p className="small dstock__key">
        <i className="dstock__tick" aria-hidden="true" /> crtica je prosjek Hrvatske ·{" "}
        <i className="dkey__dot dkey__dot--long dstock__dot" aria-hidden="true" /> više starijih i&nbsp;manje
        ordinacija
      </p>

      <div className="dstock__wrap">
        <table className="tbl dtbl">
          <caption className="visually-hidden">
            Gradovi i&nbsp;općine: udio stanovnika starijih od 65 godina i&nbsp;ordinacije na 10.000 stanovnika, poredano po
            stupcu {active?.label}
            {sort.desc ? ", silazno" : ", uzlazno"}.
          </caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const on = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className={c.num ? `${c.cls} r` : c.cls}
                    aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"}
                  >
                    <button type="button" className="tbl__sort" onClick={() => toggle(c.key)}>
                      {c.label}
                      {on ? (
                        <>
                          {sort.desc ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
                          <span className="visually-hidden">{sort.desc ? ", silazno" : ", uzlazno"}</span>
                        </>
                      ) : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody
            ref={bodyRef}
            onPointerOver={(e) => onHot(rowAt(e.target))}
            onPointerLeave={() => onHot(null)}
            onFocus={(e) => onHot(rowAt(e.target))}
            onBlur={() => onHot(null)}
          >
            {sorted.map((r, i) => {
              const gap = isGap(r, avg);
              const key = rowKey(r);
              return (
                <tr key={key} data-key={key} className={i >= shown ? "is-extra" : undefined}>
                  <th scope="row" tabIndex={-1} className="dtbl__name">
                    {gap ? <i className="dtbl__gap" aria-hidden="true" /> : null}
                    <span className="tbl__name">{r.municipality}</span>{" "}
                    <span className="tbl__sub">
                      {kindOf(r)}
                      <span className="dtbl__narrow">, {r.county}</span>
                    </span>
                    {gap ? (
                      <span className="visually-hidden">; više starijih i&nbsp;manje ordinacija od prosjeka</span>
                    ) : null}
                  </th>
                  <td className="dtbl__county">{r.county}</td>
                  <td className="r dtbl__bar dtbl__share">
                    <CellBar
                      value={r.share_65_plus_pct}
                      max={maxShare}
                      mark={avg.share}
                      tone={shareTone(r.share_65_plus_pct, avg)}
                      text={`${fmt(r.share_65_plus_pct, 1)}${NBSP}%`}
                      unit={`starijih od${NBSP}65${NBSP}godina`}
                    />
                  </td>
                  <td className="r dtbl__bar dtbl__pzz">
                    <CellBar
                      value={r.pzz_per_10k}
                      max={maxPzz}
                      mark={avg.per10k}
                      tone={pzzTone(r.pzz_per_10k, avg)}
                      text={fmt(r.pzz_per_10k, 1)}
                      unit={`ordinacija na${NBSP}10.000`}
                    />
                  </td>
                  {/* In a narrow column these two make the row's third line, each with its words. */}
                  <td className="r dtbl__gp">
                    <span className="dtbl__narrow">opća medicina </span>
                    {fmt(r.gp_per_10k, 1)}
                  </td>
                  <td className="r dtbl__pop">
                    {fmtInt(r.population)}
                    <span className="dtbl__narrow">
                      {` ${plural(r.population, "stanovnik", "stanovnika", "stanovnika")}`}
                    </span>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 ? (
              <tr className="dtbl__empty">
                <td colSpan={COLUMNS.length}>Nijedan grad ili općina ne odgovara filtru.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {/* A phone column grows by 10 at a time (all 556 would be some 40.000 px; the search and the
          county find a place faster), and every expanded table can be folded back. */}
      {rest > 0 || extra > 0 ? (
        <p className="dstock__more">
          {rest > 0 ? (
            <button ref={moreRef} type="button" className="btn" onClick={() => more(Math.min(step, rest))}>
              Prikaži više
              <span className="visually-hidden">{` (još ${fmtInt(Math.min(step, rest))})`}</span>
            </button>
          ) : null}
          {rest > step && !narrow ? (
            <button type="button" className="linkbtn" onClick={() => more(rest)}>
              Prikaži sve ({fmtInt(sorted.length)})
            </button>
          ) : null}
          {extra > 0 ? (
            <button type="button" className="linkbtn" onClick={less}>
              Prikaži manje
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
});

export function PartA({ pzzSince }: { pzzSince: string | null }) {
  const query = useQuery({ queryKey: ["access"], queryFn: api.access });
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const avg = useMemo(() => average(rows), [rows]);
  const gapCount = useMemo(() => rows.filter((r) => isGap(r, avg)).length, [rows, avg]);
  const zeros = useMemo(
    () => zerosOf(rows.filter((r) => r.share_65_plus_pct !== null && r.pzz_per_10k !== null)),
    [rows],
  );
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [hot, setHot] = useState<string | null>(null);
  const onFilter = useCallback((patch: Partial<Filter>) => setFilter((f) => ({ ...f, ...patch })), []);
  const list = useMemo(() => applyFilter(rows, filter, avg), [rows, filter, avg]);
  // The chart follows the table's filter a beat behind the typing (it redraws 556 dots).
  const marked = useDeferredValue(isFiltered(filter) ? list : null);
  const loading = query.isPending;
  const empty = query.isSuccess && rows.length === 0;
  // „stanje iz rujna 2026.” ends a sentence with the year's own full stop.
  const since = pzzSince ? `, stanje iz ${monthYear(pzzSince.slice(0, 7))}` : ".";

  return (
    <section className="dsec" id="dostupnost" aria-labelledby="dash-a" aria-busy={loading}>
      <SecHead id="dash-a" title="Više starijih, manje ordinacija" tag="Stvarni podaci" />
      {query.isError ? (
        <Failure
          title="Podaci o ordinacijama i stanovništvu trenutno se ne mogu učitati."
          onRetry={() => void query.refetch()}
        >
          Ostali dijelovi stranice ne ovise o&nbsp;njima.
        </Failure>
      ) : loading ? (
        <>
          <Busy />
          <span className="skeleton dash-sk-nums" />
          <span className="skeleton dash-sk-chart" />
          <span className="skeleton dash-sk-table" />
        </>
      ) : empty ? (
        <p className="runin dash-empty">
          <b>Nema podataka.</b> Podaci o&nbsp;stanovništvu (<Ac>DZS</Ac>) i&nbsp;ordinacijama (<Ac>HZZO</Ac>) još nisu
          preuzeti.
        </p>
      ) : (
        <>
          <dl className="dnums">
            <Figure n={fmtInt(gapCount)}>
              od {fmtInt(rows.length)} gradova i&nbsp;općina ima više starijih i&nbsp;manje ordinacija od prosjeka
            </Figure>
            {zeros.count ? (
              <Figure n={fmtInt(zeros.count)}>
                {zerosNoun(zeros)} bez ijedne ordinacije; u&nbsp;njima{" "}
                {plural(zeros.people, "živi", "žive", "živi")}{" "}
                {agree(zeros.people, "stanovnik", "stanovnika", "stanovnika")}
              </Figure>
            ) : null}
            <Figure n={`${fmt(avg.share, 1)}${NBSP}%`}>
              stanovnika Hrvatske starije je od 65 godina; na 10.000 stanovnika dolazi {fmt(avg.per10k, 1)}{" "}
              ordinacija
            </Figure>
          </dl>
          <PlaceFinder value={filter.search} onChange={(search) => onFilter({ search })}>
            <ChartHint marked={marked} total={rows.length} avg={avg} />
          </PlaceFinder>
          <figure className="dfig">
            <figcaption className="dkey">
              <span className="dkey__i">
                <i className="dkey__dot dkey__dot--long" aria-hidden="true" />
                više starijih i&nbsp;manje ordinacija ({fmtInt(gapCount)})
              </span>
              <span className="dkey__i">
                <i className="dkey__dot dkey__dot--mid" aria-hidden="true" />
                ostali ({fmtInt(rows.length - gapCount)})
              </span>
              <span className="dkey__i">
                <i className="dkey__dash" aria-hidden="true" />
                prosjek Hrvatske
              </span>
            </figcaption>
            <OutlierChart rows={rows} avg={avg} gapCount={gapCount} marked={marked} hotKey={hot} />
            <p className="credit">
              Izvor: <Ac>DZS</Ac>, Popis stanovništva 2021.; <Ac>HZZO</Ac>, ordinacije primarne zaštite s&nbsp;ugovorom
              {since}
            </p>
          </figure>
        </>
      )}
      {query.data && rows.length ? (
        <AccessTable
          rows={rows}
          list={list}
          counties={query.data.counties}
          avg={avg}
          gapCount={gapCount}
          filter={filter}
          onFilter={onFilter}
          onHot={setHot}
        />
      ) : null}
      <More title="Kako je izračunato">
        <dl className="dhow">
          <dt>Udio 65+</dt>
          <dd>Stanovnici stari 65 i&nbsp;više godina podijeljeni s&nbsp;ukupnim brojem stanovnika grada ili općine.</dd>
          <dt>Ordinacije na 10.000</dt>
          <dd>
            Ordinacije opće medicine, pedijatrije, ginekologije i&nbsp;dentalne zaštite s&nbsp;ugovorom{" "}
            <Ac end="a">HZZO</Ac>, smještene u&nbsp;naselja grada ili općine. „Opća medicina” broji samo ordinacije opće
            (obiteljske) medicine.
          </dd>
          <dt>Prosjek Hrvatske</dt>
          <dd>
            Ponderiran stanovništvom, pa mala općina utječe manje od velikog grada
            {rows.length ? `: ${fmt(avg.share, 1)}${NBSP}% i ${fmt(avg.per10k, 1)}${NBSP}ordinacija na 10.000.` : "."}
          </dd>
          <dt>Spajanje</dt>
          <dd>
            Podaci <Ac end="a">DZS</Ac> i&nbsp;<Ac end="a">HZZO</Ac> povezuju se po nazivu grada ili općine
            i&nbsp;županiji. Bez složenog indeksa: tablicu poredajte po stupcu koji vas zanima.
          </dd>
          <dt>Izvori</dt>
          <dd>
            <Ac>DZS</Ac>, Popis stanovništva 2021., stanovništvo po gradovima i&nbsp;općinama i&nbsp;dobi.{" "}
            <Ac>HZZO</Ac>, ugovorene ordinacije primarne zdravstvene zaštite{since} Ovaj dio nikad ne koristi ogledne
            podatke.
          </dd>
        </dl>
      </More>
    </section>
  );
}
