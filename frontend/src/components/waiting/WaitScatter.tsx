import { type PointerEvent, useId, useMemo, useRef, useState } from "react";

import { days, NBSP, plural, slotLongHr } from "../../format";
import { useElementWidth } from "../../hooks/useElementWidth";
import { useFontEpoch } from "../../hooks/useFontEpoch";
import { useRootFontSize } from "../../hooks/useRootFontSize";
import type { WaitOption } from "../../types";
import { instKey } from "../../waiting";
import { Typeset } from "../Typeset";
import { type Dot, inBand, kmText, layoutScatter, NEAR_KM, noteHead, noteLines, waitShort } from "./scatterLayout";

/**
 * „Bliže ili ranije?”: every institution with a free appointment is a dot, by the date of its first
 * appointment (x) and the distance from the user's place (y); best is bottom left. Dots take the
 * colour of the median scale; the nearest and the soonest option carry a ring and an FT-style note,
 * plus one striking point (close, but a long wait). A staircase joins the institutions nothing
 * beats on both counts. Drawn 1 unit = 1 px so text follows A / A+ / A++; under 480 px the chart
 * gets its own narrow layout. The whole figure: rule, headline, dek, plot with the dot's tooltip,
 * credit (the .fig classes are the page's, termini.css). The table below has the same data for
 * keyboards and screen readers. Dots carry data-inst, so the page's linked highlight marks the same
 * institution's coupon, row and county.
 */
export function WaitScatter({
  entries,
  picked,
  origin,
  median,
  procedure,
  source = "HZZO, liste čekanja (CEZIH)",
  updatedAt,
  total,
  headingLevel = 2,
}: {
  entries: WaitOption[];
  picked: WaitOption[];
  origin: string;
  /** The Croatian median for the procedure (`data.median_days`); defaults to the median of the dots. */
  median?: number | null;
  /** The procedure as read, for the chart's text alternative ("MR koljena"). */
  procedure?: string;
  source?: string;
  updatedAt?: string | null;
  /** How many institutions have a free appointment in all, when `entries` holds only the soonest. */
  total?: number;
  /** The chart's title level (3 inside the statistics section of /termini). */
  headingLevel?: 2 | 3;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(plotRef, 640);
  const root = useRootFontSize();
  const fontEpoch = useFontEpoch();
  const headId = useId();
  // The institution under the pointer, not its dot: a new width (a phone turned, a larger text)
  // moves every dot, and the ring and the tooltip follow it.
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const located = useMemo(
    () => entries.filter((e): e is Dot["e"] => e.distance_km !== null),
    [entries],
  );
  const mid = useMemo(() => {
    if (median !== undefined && median !== null) return median;
    const sorted = located.map((e) => e.wait_days).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  }, [median, located]);

  const geo = useMemo(() => {
    // Labels are measured in the page's font: measure again once it has loaded (a dependency).
    // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator -- marks the dependency
    void fontEpoch;
    return layoutScatter({ located, picked, mid, origin, width, root });
  }, [located, picked, mid, origin, width, root, fontEpoch]);

  function onMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const mx = event.clientX - box.left;
    const my = event.clientY - box.top;
    let best: { d: Dot; dist: number } | null = null;
    for (const d of geo.dots) {
      const dist = Math.hypot(d.cx - mx, d.cy - my);
      if (dist < 22 && (!best || dist < best.dist)) best = { d, dist };
    }
    setHoverKey(best ? instKey(best.d.e) : null);
  }

  if (located.length < 2) return null;

  const hover = hoverKey === null ? null : (geo.dots.find((d) => instKey(d.e) === hoverKey) ?? null);

  const n = located.length;
  const missing = entries.length - n;
  const cut = total !== undefined && total > entries.length ? total : null;
  // The tooltip's anchor slides along its width with the dot, so it never leaves the chart.
  const tipShift = hover ? `${(-Math.min(1, Math.max(0, hover.cx / geo.width)) * 100).toFixed(1)}%` : "0%";
  const updated = updatedAt ? dateShort(updatedAt) : null;
  const ustanova = (k: number) => `${k}${NBSP}${plural(k, "ustanove", "ustanove", "ustanova")}`;
  const callouts = geo.notes.filter((note) => note.callout !== null);
  const lineClass = (base: string, baseline: number, size: number) =>
    inBand(baseline, size, geo.bandTop) ? `${base} is-inband` : base;

  const Heading = `h${headingLevel}` as const;
  return (
    <figure className="fig" aria-labelledby={headId}>
      <figcaption>
        <Heading className="fig__h" id={headId}>
          Bliže ili ranije?
        </Heading>
        <p className="fig__dek">
          {cut
            ? `Točka je jedna od ${ustanova(n)} s najranijim terminom (od ${cut}).`
            : `Točka je jedna od ${ustanova(n)}.`}
          {missing > 0
            ? ` ${missing}${NBSP}${plural(missing, "ustanova nema", "ustanove nemaju", "ustanova nema")} poznatu lokaciju, pa ${missing === 1 ? "nije" : "nisu"} na grafu.`
            : ""}{" "}
          Lijevo je raniji termin, dolje bliže mjestu {origin}. Najbolje je dolje lijevo.
        </p>
      </figcaption>
      {/* A touch "leaves" when the finger lifts: the tooltip stays until the next tap. */}
      <div className="fig__plot fig__frame" ref={plotRef} onPointerLeave={(e) => e.pointerType === "mouse" && setHoverKey(null)}>
        <svg
          className="ch fig__svg"
          width={geo.width}
          height={geo.height}
          viewBox={`0 0 ${geo.width} ${geo.height}`}
          role="img"
          aria-label={`Točkasti graf: ${n} ${plural(n, "ustanova", "ustanove", "ustanova")} sa slobodnim terminom${procedure ? ` za ${procedure}` : ""}; vodoravno datum prvog termina, okomito udaljenost od mjesta ${origin}. Isti podaci su u tablici svih ustanova.`}
          onPointerMove={onMove}
          onPointerDown={onMove}
        >
          {geo.band ? (
            <rect className="ch__band" x={geo.ml} y={geo.band.y0} width={geo.plotW} height={geo.baseY - geo.band.y0} />
          ) : null}
          {geo.yTicks.map((t) => (
            <g key={t.v}>
              {t.v > 0 ? <line className="ch__grid" x1={geo.ml} x2={geo.ml + geo.plotW} y1={t.y} y2={t.y} /> : null}
              <text className="ch__tick" x={geo.ml - 8} y={t.y} dy="0.34em" textAnchor="end">
                {t.text}
              </text>
            </g>
          ))}
          <line className="ch__base" x1={geo.ml} x2={geo.ml + geo.plotW} y1={geo.baseY} y2={geo.baseY} />
          {geo.xTicks.map((t) => (
            <g key={t.x}>
              <line className="ch__axis" x1={t.x} x2={t.x} y1={geo.baseY} y2={geo.baseY + 6} />
              {t.text ? (
                <text className={`ch__tick ch__tick--t${t.strong ? " ch__tick--b" : ""}`} x={t.lx} y={geo.tickY}>
                  {t.text}
                </text>
              ) : null}
            </g>
          ))}
          <line className="ch__today" x1={geo.ml} x2={geo.ml} y1={geo.labelY + 5} y2={geo.baseY} />
          <text className="ch__small" x={geo.today0.x} y={geo.today0.y}>
            danas
          </text>
          {geo.medianX !== null && geo.medianLabel ? (
            <>
              <line className="ch__median" x1={geo.medianX} x2={geo.medianX} y1={geo.labelY + 5} y2={geo.baseY} />
              <text
                className={lineClass("ch__small ch__halo", geo.medianLabel.y, geo.fs)}
                x={geo.medianLabel.x}
                y={geo.medianLabel.y}
                textAnchor={geo.medianLabel.anchor}
              >
                {geo.medianLabel.text}
              </text>
            </>
          ) : null}
          <text className="ch__small" x={geo.axisLabel.x} y={geo.axisLabel.y} textAnchor="end">
            {geo.axisLabel.text}
          </text>
          {/* Over the grid (its halo is the band's tint), under the dots. */}
          {geo.band?.label ? (
            <text className="ch__bandlabel" x={geo.band.label.lx} y={geo.band.label.ly}>
              {geo.band.label.text}
            </text>
          ) : null}
          {geo.frontPath ? <path className="ch__front" d={geo.frontPath} /> : null}
          {geo.frontLabel ? (
            <text
              className={lineClass("ch__note ch__front-lab", geo.frontLabel.y, geo.fsNote)}
              x={geo.frontLabel.x}
              y={geo.frontLabel.y}
              textAnchor={geo.frontLabel.anchor}
            >
              {geo.frontLabel.text}
            </text>
          ) : null}
          {geo.dots.map((d) => (
            <g key={d.key}>
              {d.picked ? <circle className="ch__ring" cx={d.cx} cy={d.cy} r={11} /> : null}
              <circle
                className={`ch__dot ch__dot--${d.tone}`}
                cx={d.cx}
                cy={d.cy}
                r={d.picked ? 6.5 : 5.5}
                data-inst={instKey(d.e)}
                data-county={d.e.county ?? undefined}
              />
            </g>
          ))}
          {hover ? (
            <circle className="ch__ring ch__ring--hover" cx={hover.cx} cy={hover.cy} r={hover.picked ? 14.5 : 9.5} />
          ) : null}
          {geo.notes.map((note) =>
            note.callout !== null ? (
              <g key={note.key} className="ch__badge" aria-hidden="true">
                <circle
                  cx={(note.box.x0 + note.box.x1) / 2}
                  cy={(note.box.y0 + note.box.y1) / 2}
                  r={(note.box.x1 - note.box.x0) / 2}
                />
                <text x={(note.box.x0 + note.box.x1) / 2} y={(note.box.y0 + note.box.y1) / 2} dy="0.36em" textAnchor="middle">
                  {note.callout}
                </text>
              </g>
            ) : (
              <g key={note.key} className="ch__note-g">
                {note.leader ? <path className="ch__leader" d={note.leader} /> : null}
                {note.label.map((line) => (
                  <text
                    key={`b-${line.y}`}
                    className={lineClass("ch__lab", line.y, geo.fs)}
                    x={note.x}
                    y={line.y}
                    textAnchor={note.anchor}
                  >
                    {line.text}
                  </text>
                ))}
                {note.lines.map((line) => (
                  <text
                    key={`i-${line.y}`}
                    className={lineClass("ch__note", line.y, geo.fsNote)}
                    x={note.x}
                    y={line.y}
                    textAnchor={note.anchor}
                  >
                    {line.text}
                  </text>
                ))}
              </g>
            ),
          )}
        </svg>
        {hover ? (
          <div
            className="tooltip ch-tip"
            role="presentation"
            style={{ left: hover.cx, top: hover.cy, transform: `translate(${tipShift}, calc(-100% - 0.9rem))` }}
          >
            <strong>
              <Typeset text={hover.e.spoken_name} />
            </strong>
            {hover.e.settlement ? `${hover.e.settlement} · ` : ""}
            {hover.e.distance_km < 2 ? "u vašem mjestu" : `oko ${kmText(hover.e.distance_km)}`}
            <br />
            {hover.e.wait_days > 1 ? `za ${days(hover.e.wait_days)}` : waitShort(hover.e.wait_days)}
            <br />
            {slotLongHr(hover.e.first_slot)}
          </div>
        ) : null}
      </div>
      {callouts.length ? (
        <ol className="fig__key">
          {callouts.map((note) => {
            const { place, when } = noteHead(note.dot);
            return (
              <li key={note.key}>
                <b className="fig__key-n">{note.callout}</b>{" "}
                <b>
                  {place}, {when}:
                </b>{" "}
                {noteLines(note.kind, note.dot.e, false).join(" ")}.
              </li>
            );
          })}
        </ol>
      ) : null}
      <p className="credit">
        <b>Izvor:</b> <Typeset text={source} />
        {updated ? `, ${updated}` : "."} Udaljenost je zračna.{" "}
        {/* A crowded band has no room for its name: the credit names it instead. */}
        {geo.band && !geo.band.label ? `Pojas pri dnu grafa: do ${NEAR_KM}${NBSP}km od mjesta ${origin}. ` : null}
        {geo.medianLabel?.text === "medijan" ? `Crtkana crta: medijan u Hrvatskoj, ${days(mid)}. ` : null}
        {geo.frontCount
          ? `Stepenasta crta spaja ${geo.frontCount}${NBSP}${plural(geo.frontCount, "ustanovu", "ustanove", "ustanova")} od kojih nijedna druga nije i bliža i ranija. `
          : null}
        Boja točke: tirkizno kraće, sivo oko, crveno dulje od medijana.
      </p>
    </figure>
  );
}

const shortDate = new Intl.DateTimeFormat("hr-HR", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  timeZone: "Europe/Zagreb",
});

/** "27. 10. 2026." with non-breaking spaces. */
function dateShort(iso: string): string | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : shortDate.format(d).replace(/\s/g, NBSP);
}
