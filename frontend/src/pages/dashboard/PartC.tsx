/** Dashboard part C: what was asked, by whom and with what answer (sample rows apart). */
import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useId, useRef, useState } from "react";

import { api } from "../../api";
import { CATEGORY_LABELS } from "../../categories";
import { agree, capitalize, dateHr, dayHr, fmt, fmtInt, namesHr, NBSP, plural } from "../../format";
import { useElementWidth } from "../../hooks/useElementWidth";
import { useFontEpoch } from "../../hooks/useFontEpoch";
import { useRootFontSize } from "../../hooks/useRootFontSize";
import { textWidth } from "../../measure";
import type { Bucket, Stats } from "../../types";
import { Busy, Check, Failure, Figure, More, SecHead } from "./parts";

/* ================================================================== part C: query statistics */

const TOOL_LABELS: Record<string, string> = {
  find_health_facilities: "ambulante i bolnice",
  find_waiting_times: "liste čekanja",
  get_drug_info: "lijekovi",
};
/** „6 o ambulantama i bolnicama”: what the questions were about, in a sentence. */
const TOOL_ABOUT: Record<string, string> = {
  find_health_facilities: "o ambulantama i bolnicama",
  find_waiting_times: "o listama čekanja",
  get_drug_info: "o lijekovima",
};
const STATUS_LABELS: Record<string, string> = {
  not_found: "nije pronađeno",
  no_data: "nema podataka",
  ambiguous: "nejasan upit",
};
const ASKED_FOR: Record<string, string> = {
  find_waiting_times: "Postupak",
  find_health_facilities: "Ustanova",
  get_drug_info: "Lijek",
};
const TOPIC_LABELS: Record<string, string> = {
  ...CATEGORY_LABELS,
  brand: "lijek po nazivu",
  substance: "djelatna tvar",
  family_medicine: "opća medicina",
  pediatrics: "pedijatrija",
  gynecology: "ginekologija",
  dentistry: "dentalna zaštita",
  hospital: "bolnice",
  any: "sve ustanove",
};
/** The two profiles as the rest of the site names them (O projektu: premium and the open one). */
const PROFILE_LABELS: Record<string, string> = {
  premium: "Premium profil",
  open: "Otvoreni profil",
  nepoznato: "Profil nije zabilježen",
};

/** Real queries at or above this many are worth charting on their own, without sample data. */
const ENOUGH_REAL = 50;

/** Rows a small multiple shows first in a phone column (and every row with real queries). */
const FOLD = 3;

interface Row {
  key: string;
  label: string;
  sub?: string;
  real: number;
  demo: number;
}

/** The real part of a bar is never thinner than 3 px, so one real query still shows; the sample
 * part gives those pixels back, so the longest bar ends on its column's edge. */
function barWidths(r: Row, max: number): { real: string | number; demo: string } {
  const real = (r.real / max) * 100;
  const demo = (r.demo / max) * 100;
  if (!r.real) return { real: 0, demo: `${demo}%` };
  return { real: `max(3px, ${real}%)`, demo: `max(0px, ${demo}% - max(0px, 3px - ${real}%))` };
}

const sumOf = (rows: Row[]) => rows.reduce((n, r) => n + r.real + r.demo, 0);

/**
 * A small multiple: horizontal bars from one shared ink baseline, the real part teal, the sample
 * part hatched grey. On the proof sheet every count says what it is made of: the real share
 * beside a mixed total („458 · 6 stvarnih”), „svi stvarni” beside a total with no sample in it,
 * so no number on the sheet passes for sample data. The rows past the limit are summed in a line
 * („i još 13 županija (358 upita)”). In a phone column the first rows show and the others open.
 * On the proof sheet real queries are never put away: a row with any keeps its bar past the limit
 * and when folded, so what the line sums and what the fold hides is sample data only.
 */
function Multiple({
  title,
  rows,
  sample,
  limit = 8,
  restNoun,
  foot,
}: {
  title: string;
  rows: Row[];
  /** The sheet shows sample data (part C's checkbox). */
  sample: boolean;
  limit?: number;
  /** What the rows past the limit are: „županija”, „županije”, „županija”. */
  restNoun?: [string, string, string];
  foot?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const all = rows.filter((r) => r.real + r.demo > 0).sort((a, b) => b.real + b.demo - (a.real + a.demo));
  // On the proof sheet a row with real queries is never put away among sample ones; with real
  // data alone the limit and the fold apply to every row.
  const keep = (r: Row) => sample && r.real > 0;
  const sorted = all.filter((r, i) => i < limit || keep(r));
  const hidden = all.filter((r, i) => i >= limit && !keep(r));
  const max = Math.max(1, ...sorted.map((r) => r.real + r.demo));
  // In a phone column: the rows after the first few, except those kept.
  const folded = sorted.filter((r, i) => i >= FOLD && !keep(r));
  const folds = folded.length > 1;
  const foldedKeys = new Set(folds ? folded.map((r) => r.key) : []);
  // The line of the rest counts what is out of sight: past the limit, and folded away on a phone.
  const rest = (out: Row[], cls?: string) =>
    out.length && restNoun ? (
      <p className={cls ? `small mult__rest ${cls}` : "small mult__rest"}>
        i još {agree(out.length, ...restNoun)} ({agree(sumOf(out), "upit", "upita", "upita")})
      </p>
    ) : null;
  return (
    <div className={`mult${open ? " is-open" : ""}`}>
      <h3 className="mult__h">{title}</h3>
      {sorted.length ? (
        <>
          <ol className="mbar" id={listId}>
            {sorted.map((r) => {
              const w = barWidths(r, max);
              return (
                <li key={r.key} className={foldedKeys.has(r.key) ? "mbar__more" : undefined}>
                  <span className="mbar__l">
                    {r.label}
                    {r.sub ? <span className="mbar__sub">{r.sub}</span> : null}
                  </span>
                  <span className="mbar__n">
                    {fmtInt(r.real + r.demo)}
                    {r.demo && r.real ? (
                      <span className="mbar__rn">
                        {" · "}
                        {agree(r.real, "stvaran", "stvarna", "stvarnih")}
                      </span>
                    ) : r.demo ? (
                      <span className="visually-hidden">, svi ogledni</span>
                    ) : sample ? (
                      <span className="mbar__rn">{r.real === 1 ? " · stvaran" : " · svi stvarni"}</span>
                    ) : null}
                  </span>
                  <span className="mbar__bar" aria-hidden="true">
                    <i className="mbar__real" style={{ width: w.real }} />
                    <i className="mbar__demo" style={{ width: w.demo }} />
                  </span>
                </li>
              );
            })}
          </ol>
          {folds ? (
            <>
              {rest(hidden, "mult__rest--open")}
              {rest([...folded, ...hidden], "mult__rest--folded")}
            </>
          ) : (
            rest(hidden)
          )}
          {folds ? (
            <button
              type="button"
              className="btn btn--sm mult__more"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Prikaži manje" : `Prikaži još ${folded.length}`}
            </button>
          ) : null}
        </>
      ) : (
        <p className="small">{foot ?? "Nema upita u ovom razdoblju."}</p>
      )}
    </div>
  );
}

/** A round step for 3 or 4 gridlines: 1, 2, 5, 10, 20, 25, 50, 100 … */
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const f = raw / pow;
  return Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow);
}

/** „14. 10.”, a day of the log („2026-10-14”) as the axis writes it. */
const dayLabel = (key: string) => dayHr(key);

/** The figures of one day as the readout gives them: „7 stvarnih · 43 ogledna”, „nema upita”. */
function dayFigures(b: Bucket, showDemo: boolean): string {
  if (b.real + (showDemo ? b.demo : 0) === 0) return "nema upita";
  return showDemo
    ? `${agree(b.real, "stvaran", "stvarna", "stvarnih")} · ${agree(b.demo, "ogledni", "ogledna", "oglednih")}`
    : agree(b.real, "stvaran upit", "stvarna upita", "stvarnih upita");
}

/**
 * Queries per day as columns on an ink baseline; the sample part of a column is hatched. The day
 * in hand (under the pointer, tapped, or walked with the arrow keys: the chart is one keyboard
 * stop) is outlined, and its figures are read out on the title's line, never over the columns.
 * Screen readers get the same figures in the hidden table. Renders the figure's caption too.
 */
function DailyColumns({
  data,
  showDemo,
  title,
  titleId,
}: {
  data: Bucket[];
  showDemo: boolean;
  title: string;
  titleId: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrapRef, 720);
  const root = useRootFontSize();
  useFontEpoch();
  const hatch = `dash-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [hover, setHover] = useState<number | null>(null);
  const last = data.length - 1;
  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    const to =
      e.key === "ArrowLeft"
        ? Math.max(0, (hover ?? last) - 1)
        : e.key === "ArrowRight"
          ? Math.min(last, (hover ?? last) + 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (to === null) return;
    e.preventDefault();
    setHover(to);
  }

  const fs = root * 0.78;
  const narrow = width < 520;
  const height = Math.round(root * (narrow ? 10 : 11.5));
  const m = { top: fs * 1.1, right: 2, bottom: fs * 2.3, left: fs * 2.8 };
  const plotW = Math.max(10, width - m.left - m.right);
  const plotH = Math.max(10, height - m.top - m.bottom);
  const totals = data.map((b) => b.real + (showDemo ? b.demo : 0));
  const top = Math.max(...totals, 1);
  const step = niceStep(top / 3);
  const yMax = Math.ceil(top / step) * step;
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(2, band * 0.7);
  const sy = (v: number) => m.top + plotH - (v / yMax) * plotH;
  const colX = (i: number) => m.left + i * band + (band - barW) / 2;

  // A tick every week counted back from the newest day, or every second or third week where the
  // dates would not fit. Each date is centred under its column; the newest ends with its column
  // (it is the chart's edge), and a date that would come within an em of the next one to its right
  // is left out, its tick kept, so no two dates ever read as one.
  const widest = Math.max(0, ...data.map((b) => textWidth(dayLabel(b.key), fs)));
  const every = 7 * Math.max(1, Math.ceil((widest + fs) / (band * 7)));
  const tickAt = new Set<number>();
  const dates = new Map<number, { x: number; anchor: "start" | "middle" | "end" }>();
  let bound = Number.POSITIVE_INFINITY;
  for (let i = last; i >= 0; i -= every) {
    const b = data[i];
    if (!b) continue;
    tickAt.add(i);
    const w = textWidth(dayLabel(b.key), fs);
    const x = colX(i);
    const cx = x + barW / 2;
    const anchor = cx + w / 2 > width ? "end" : cx - w / 2 < 0 ? "start" : "middle";
    const left = anchor === "end" ? x + barW - w : anchor === "start" ? x : cx - w / 2;
    if (left + w > bound - fs) continue;
    dates.set(i, { x: anchor === "end" ? x + barW : anchor === "start" ? x : cx, anchor });
    bound = left;
  }

  const h = hover !== null ? data[hover] : undefined;

  return (
    <>
      <figcaption className="dcols__cap">
        <h3 id={titleId} className="dfig__title">
          {title}
        </h3>
        <p className="small dcols__read">
          <span aria-live="polite">
            {h ? (
              <>
                <b>{dayLabel(h.key)}</b> {dayFigures(h, showDemo)}
              </>
            ) : null}
          </span>
          {h ? null : (
            <span className="dcols__idle" aria-hidden="true">
              Odaberite dan na grafu.
            </span>
          )}
        </p>
      </figcaption>
      <div className="dcols" ref={wrapRef}>
        <svg
          className="ch dcols__svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Upiti po danu u zadnjih ${data.length} dana${showDemo ? ", stvarni i ogledni" : ", samo stvarni"}. Brojke su u tablici ispod grafa.`}
          tabIndex={0}
          onPointerLeave={(e) => {
            // A tapped day stays in hand (a finger leaves the screen after every tap).
            if (e.pointerType !== "touch") setHover(null);
          }}
          onKeyDown={onKey}
          onFocus={(e) => {
            if (e.currentTarget.matches(":focus-visible")) setHover((v) => v ?? last);
          }}
          onBlur={() => setHover(null)}
        >
          <defs>
            <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" fill="var(--demo-bg)" />
              <line x1="1" y1="0" x2="1" y2="5" stroke="var(--demo-line)" strokeWidth="1.6" />
            </pattern>
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              {v > 0 ? <line className="ch__grid" x1={m.left} x2={m.left + plotW} y1={sy(v)} y2={sy(v)} /> : null}
              <text
                className="ch__tick"
                x={m.left - 7}
                y={sy(v)}
                dy="0.34em"
                textAnchor="end"
                style={{ fontSize: fs }}
              >
                {fmtInt(v)}
              </text>
            </g>
          ))}
          {data.map((b, i) => {
            const x = colX(i);
            const demo = showDemo ? b.demo : 0;
            const realTop = sy(b.real);
            const allTop = sy(b.real + demo);
            const date = dates.get(i);
            return (
              <g key={b.key} onPointerEnter={() => setHover(i)}>
                <rect x={m.left + i * band} y={m.top} width={band} height={plotH} fill="transparent" />
                {demo > 0 ? (
                  <rect
                    className="dcols__demo"
                    x={x}
                    y={allTop}
                    width={barW}
                    height={realTop - allTop}
                    fill={`url(#${hatch})`}
                  />
                ) : null}
                {b.real > 0 ? (
                  <rect className="dcols__real" x={x} y={realTop} width={barW} height={m.top + plotH - realTop} />
                ) : null}
                {tickAt.has(i) ? (
                  <line
                    className="ch__axis"
                    x1={x + barW / 2}
                    x2={x + barW / 2}
                    y1={m.top + plotH}
                    y2={m.top + plotH + 4}
                  />
                ) : null}
                {date ? (
                  <text
                    className="ch__tick"
                    x={date.x}
                    y={m.top + plotH + fs * 1.6}
                    textAnchor={date.anchor}
                    style={{ fontSize: fs }}
                  >
                    {dayLabel(b.key)}
                  </text>
                ) : null}
                {/* The day in hand is outlined; a day without queries has nothing to outline. */}
                {hover === i && b.real + demo > 0 ? (
                  <rect
                    className="dcols__hover"
                    x={x - 1.5}
                    y={allTop - 1.5}
                    width={barW + 3}
                    height={m.top + plotH - allTop + 1.5}
                  />
                ) : null}
              </g>
            );
          })}
          <line className="ch__base" x1={m.left} x2={m.left + plotW} y1={m.top + plotH} y2={m.top + plotH} />
        </svg>
        {/* A table is never narrower than its content, so the hiding goes on a wrapper. */}
        <div className="visually-hidden">
          <table>
            <caption>Upiti po danu</caption>
            <thead>
              <tr>
                <th scope="col">Dan</th>
                <th scope="col">Stvarni upiti</th>
                {showDemo ? <th scope="col">Ogledni upiti</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.key}>
                  <th scope="row">{dateHr(`${b.key}T12:00:00`)}</th>
                  <td>{b.real}</td>
                  {showDemo ? <td>{b.demo}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function rowsOf(buckets: Bucket[], showDemo: boolean, label: (key: string) => { label: string; sub?: string }): Row[] {
  return buckets.map((b) => ({ key: b.key, ...label(b.key), real: b.real, demo: showDemo ? b.demo : 0 }));
}

/**
 * „find_waiting_times:not_found:ct” → CT, under it „liste čekanja · nije pronađeno”. A question
 * that never got as far as a topic has its status there instead: named by what was asked for.
 */
function unansweredLabel(key: string): { label: string; sub?: string } {
  const [tool = "", status = "", topic = ""] = key.split(":");
  const asked = !topic || topic === status;
  return {
    label: asked ? (ASKED_FOR[tool] ?? capitalize(tool)) : capitalize(TOPIC_LABELS[topic] ?? topic),
    sub: [TOOL_LABELS[tool] ?? tool, STATUS_LABELS[status] ?? status].filter(Boolean).join(" · "),
  };
}

/** „30. 9.–29. 10. 2026.” from two days of the log („2026-09-30”, „2026-10-29”). */
function rangeHr(from: string, to: string): string {
  return `${dayHr(from, from.slice(0, 4) !== to.slice(0, 4))}–${dayHr(to, true)}`;
}

/** Where the numbers of part C come from, under its charts like every other credit. */
function StatsCredit({ s }: { s: Stats }) {
  const from = s.by_day[0]?.key;
  const to = s.by_day.at(-1)?.key;
  return (
    <p className="credit dstats__credit">
      <b>Izvor:</b> dnevnik upita asistenta{from && to ? `, ${rangeHr(from, to)}` : ""}; osvježava se svake minute.
    </p>
  );
}

/**
 * The charts of part C: per day across the width, then the small multiples (three columns on a
 * wide page, the two short ones stacked in the first, so the columns end close together).
 */
function StatsCharts({ s, showDemo }: { s: Stats; showDemo: boolean }) {
  const daysId = useId();
  return (
    <div className="dstats">
      {/* Named by its title only: the caption also carries the readout of the day in hand. */}
      <figure className="dfig dfig--days" aria-labelledby={daysId}>
        <DailyColumns data={s.by_day} showDemo={showDemo} title="Upiti po danu" titleId={daysId} />
      </figure>
      <div className="mults">
        <div className="mults__stack">
          {/* By the tool the question went to; its topic is under „Bez odgovora”. */}
          <Multiple
            title="Vrsta pitanja"
            sample={showDemo}
            rows={rowsOf(s.by_tool, showDemo, (k) => ({ label: capitalize(TOOL_LABELS[k] ?? k) }))}
          />
          <div className="mult-wide">
            <Multiple
              title="Profil"
              sample={showDemo}
              rows={rowsOf(s.by_profile, showDemo, (k) => ({ label: PROFILE_LABELS[k] ?? k }))}
            />
          </div>
        </div>
        <Multiple
          title="Županije"
          sample={showDemo}
          rows={rowsOf(s.by_county, showDemo, (k) => ({ label: k }))}
          restNoun={["županija", "županije", "županija"]}
        />
        <Multiple
          title="Bez odgovora: što nedostaje"
          sample={showDemo}
          rows={rowsOf(s.unanswered, showDemo, unansweredLabel)}
          restNoun={["tema", "teme", "tema"]}
          foot="Svi upiti u ovom razdoblju imali su odgovor."
        />
      </div>
      <StatsCredit s={s} />
    </div>
  );
}

/** „9 %”: both shares of the proof's lede are said the same way, in whole percent. */
const pct = (part: number, whole: number) => `${fmt((part / whole) * 100, 0)}${NBSP}%`;

export function PartC() {
  const query = useQuery({ queryKey: ["stats"], queryFn: api.stats, refetchInterval: 60_000 });
  const [showDemo, setShowDemo] = useState(true);
  const s = query.data;
  const real = s?.totals.real ?? 0;
  const demo = s?.totals.demo ?? 0;
  // Without sample rows (a fresh install, or production once they are removed) there is nothing
  // to switch on: no checkbox, and no advice to tick it.
  const hasDemo = demo > 0;
  // The shares in the proof's lede are the sample's own, and the sentence says so: the real
  // queries are counted in bold just before it and must not lend it their weight.
  const demoUnanswered = s ? s.unanswered.reduce((n, b) => n + b.demo, 0) : 0;
  const demoOpen = s?.by_profile.find((b) => b.key === "open")?.demo ?? 0;
  const windowDays = s ? `${fmtInt(s.window_days)}${NBSP}dana` : "";
  // Sample rows are dated when they were generated; if that was days ago, the sample stops before
  // the window does, and the legend says where, so the empty last days read as „no sample”.
  const demoUntil = s?.by_day.filter((b) => b.demo > 0).at(-1)?.key ?? null;
  const lastDay = s?.by_day.at(-1)?.key ?? null;
  const demoEnds = demoUntil && lastDay && demoUntil < lastDay ? demoUntil : null;
  // What the few real queries were about: „Od toga 6 o ambulantama i bolnicama, 2 o listama
  // čekanja i 2 o lijekovima.”, or „Svi su bili o lijekovima.” when there is only the one tool.
  const realTools = s ? s.by_tool.filter((b) => b.real > 0).sort((a, b) => b.real - a.real) : [];
  const [onlyTool] = realTools;
  const byTool =
    realTools.length > 1
      ? ` Od toga ${namesHr(realTools.map((b) => `${fmtInt(b.real)} ${TOOL_ABOUT[b.key] ?? b.key}`))}.`
      : onlyTool
        ? ` ${real === 1 ? "Bio je" : "Svi su bili"} ${TOOL_ABOUT[onlyTool.key] ?? onlyTool.key}.`
        : "";

  return (
    <section className="dsec" id="upiti" aria-labelledby="dash-c" aria-busy={query.isPending}>
      <SecHead
        id="dash-c"
        title="Što ljudi pitaju"
        tag={showDemo && hasDemo ? "Stvarni i ogledni podaci" : "Stvarni podaci"}
        demo={showDemo && hasDemo}
      >
        {hasDemo ? (
          <Check checked={showDemo} onChange={setShowDemo}>
            Prikaži ogledne podatke
          </Check>
        ) : null}
      </SecHead>
      {query.isError ? (
        <Failure title="Statistika upita trenutno se ne može učitati." onRetry={() => void query.refetch()}>
          Ostali dijelovi stranice ne ovise o&nbsp;njoj.
        </Failure>
      ) : !s ? (
        <>
          <Busy />
          <span className="skeleton dash-sk-nums" />
          <span className="skeleton dash-sk-proof" />
        </>
      ) : (
        <>
          {/* The real count stands outside the sample sheet, so it is never read as sample data. */}
          <dl className="dnums dnums--one">
            <Figure n={fmtInt(real)}>
              {plural(real, "stvaran upit", "stvarna upita", "stvarnih upita")} u&nbsp;zadnjih {windowDays}.{byTool}
            </Figure>
          </dl>
          {showDemo && hasDemo ? (
            <div className="demo" role="group" aria-labelledby="dash-demo">
              <p className="demo__stamp" id="dash-demo">
                Ogledni podaci, nisu stvarna upotreba
              </p>
              <p className="demo__lede">
                {agree(demo, "ogledni upit", "ogledna upita", "oglednih upita")}. Bez odgovora ostaje{" "}
                {pct(demoUnanswered, demo)}, a&nbsp;{pct(demoOpen, demo)} stiže preko otvorenog profila.
              </p>
              <p className="dkey">
                <span className="dkey__i">
                  <i className="dkey__sw dkey__sw--real" aria-hidden="true" />
                  stvarni upiti
                </span>
                <span className="dkey__i">
                  <i className="dkey__sw dkey__sw--demo" aria-hidden="true" />
                  ogledni, šrafirano
                  {demoEnds
                    ? `, zaključno s${NBSP}${Number(demoEnds.slice(8, 10))}.${NBSP}${Number(demoEnds.slice(5, 7))}.`
                    : ""}
                </span>
              </p>
              <StatsCharts s={s} showDemo />
            </div>
          ) : real < ENOUGH_REAL ? (
            <p className="small dquiet" role="status">
              Grafovi se prikazuju kad bude barem {ENOUGH_REAL} stvarnih upita
              {hasDemo ? "; dotad uključite ogledne podatke da vidite kako će izgledati." : "."}
            </p>
          ) : (
            <StatsCharts s={s} showDemo={false} />
          )}
        </>
      )}
      <More title="Što se bilježi">
        <p>
          Za svaki upit samo alat, tema, općina ili županija, profil i&nbsp;vrijeme, bez transkripata. Ogledni podaci
          služe samo za prikaz ovog dijela i&nbsp;nikad ne ulaze u&nbsp;dijelove sa stvarnim podacima.
        </p>
      </More>
    </section>
  );
}
