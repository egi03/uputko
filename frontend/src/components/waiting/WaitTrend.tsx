import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import { api } from "../../api";
import { dayHr, days, fmt, NBSP } from "../../format";
import { useElementWidth } from "../../hooks/useElementWidth";
import { useRootFontSize } from "../../hooks/useRootFontSize";

const MIN_DAYS = 3;

/** "2026-10-27" -> a day count, so a day without a snapshot keeps its place on the axis. */
function dayIndex(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return y && m && d ? Date.UTC(y, m - 1, d) / 86_400_000 : Number.NaN;
}

/** A scale that shows the change without blowing it up: at least ±20 % around the mean, in tens. */
function domain(values: number[]): [number, number] {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const lo = Math.max(0, Math.floor(Math.min(...values, mean * 0.8) / 10) * 10);
  const hi = Math.ceil(Math.max(...values, mean * 1.2) / 10) * 10;
  return [lo, hi > lo ? hi : lo + 10];
}

interface Point {
  day: string;
  median_days: number;
}

/**
 * The Croatian median wait for one procedure, day by day, from the daily snapshots of the lists.
 * The portal keeps no history, so the line grows one point a day; until there are three days the
 * component renders nothing.
 */
export function WaitTrend({ procedureId }: { procedureId: number }) {
  const trend = useQuery({
    queryKey: ["waiting-trend", procedureId],
    queryFn: () => api.waitingTrend(procedureId),
  });
  const points = (trend.data?.days ?? []).filter((d): d is Point & { lists: number } => d.median_days !== null);
  return points.length < MIN_DAYS ? null : <TrendFigure points={points} />;
}

/**
 * A compact figure: a 1.5 px ink line along the calendar (a day without a snapshot keeps its
 * width), the last day as a teal point with its value, drawn 1 unit = 1 px so the text follows
 * A / A+ / A++; the values are listed for screen readers.
 */
function TrendFigure({ points }: { points: Point[] }) {
  const plotRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(plotRef, 320);
  const root = useRootFontSize();
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;

  const fs = root * 0.78;
  const values = points.map((p) => p.median_days);
  const [lo, hi] = domain(values);
  const ml = Math.ceil(fs * 2.2);
  const mr = 6;
  const mt = Math.round(fs * 1.9);
  const mb = Math.round(fs * 1.7);
  const height = Math.round(mt + mb + fs * 4.6);
  const plotW = Math.max(40, width - ml - mr);
  const plotH = height - mt - mb;
  // Time runs by the calendar: a day the lists were not saved is a gap, not a squeezed step.
  const start = dayIndex(first.day);
  const span = Math.max(1, dayIndex(last.day) - start);
  const at = (p: Point, i: number) => {
    const t = (dayIndex(p.day) - start) / span;
    return Number.isFinite(t) ? t : i / Math.max(1, points.length - 1);
  };
  const x = (t: number) => ml + t * plotW;
  const y = (v: number) => mt + plotH - ((v - lo) / (hi - lo)) * plotH;
  const line = points.map((p, i) => `${x(at(p, i)).toFixed(1)},${y(p.median_days).toFixed(1)}`).join(" ");
  const lx = x(1);
  const ly = y(last.median_days);

  return (
    <figure className="trend">
      <figcaption className="small">
        <b>Trend.</b> Medijan čekanja u&nbsp;Hrvatskoj po danu, iz dnevnih snimki lista od{NBSP}
        {dayHr(first.day)}
      </figcaption>
      <div className="trend__plot" ref={plotRef}>
        <svg
          className="ch"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Medijan čekanja od ${days(first.median_days)} (${dayHr(first.day)}) do ${days(last.median_days)} (${dayHr(last.day)}); najmanje ${days(Math.min(...values))}, najviše ${days(Math.max(...values))}.`}
        >
          {[lo, hi].map((v) => (
            <g key={v}>
              <line className="ch__grid" x1={ml} x2={ml + plotW} y1={y(v)} y2={y(v)} />
              <text className="ch__tick" x={ml - 6} y={y(v)} dy="0.34em" textAnchor="end">
                {fmt(v)}
              </text>
            </g>
          ))}
          <polyline className="ch__line" points={line} />
          <circle className="ch__last" cx={lx} cy={ly} r={4.5} />
          <text className="ch__lab" x={lx} y={ly - fs * 0.85} textAnchor="end">
            {days(last.median_days)}, {dayHr(last.day)}
          </text>
          <text className="ch__tick ch__tick--t" x={ml} y={height - fs * 0.35}>
            {dayHr(first.day)}
          </text>
        </svg>
      </div>
      <ol className="visually-hidden">
        {points.map((p) => (
          <li key={p.day}>
            {dayHr(p.day)}: {days(p.median_days)}
          </li>
        ))}
      </ol>
    </figure>
  );
}
