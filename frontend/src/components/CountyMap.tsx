import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";

import { api } from "../api";
import { useElementWidth } from "../hooks/useElementWidth";
import { useRootFontSize } from "../hooks/useRootFontSize";
import type { CountyFeature } from "../types";

/** What a county shows: its fill colour and a short text for screen readers and the tooltip. */
export interface CountyValue {
  fill: string;
  label: string;
}

/** A place marked on the map: the user's place (ink ring) or the soonest appointment (teal). */
export interface MapMark {
  kind: "origin" | "soon";
  lon: number;
  lat: number;
  /** "Vinkovci", "Rijeka · 9 dana". */
  label: string;
}

/** Reference cities: a dot and a name on a halo of paper. */
const CITIES: { name: string; lon: number; lat: number; side: "start" | "end" }[] = [
  { name: "Zagreb", lon: 15.982, lat: 45.815, side: "start" },
  { name: "Split", lon: 16.44, lat: 43.508, side: "end" },
  { name: "Osijek", lon: 18.694, lat: 45.555, side: "end" },
  { name: "Zadar", lon: 15.231, lat: 44.119, side: "end" },
];
const PAD = 8;
const NO_MARKS: MapMark[] = [];

type Project = (lon: number, lat: number) => [number, number];

/** Equirectangular with the cosine of the mean latitude, fitted to the width in px. */
function makeProjection(features: CountyFeature[], width: number): { project: Project; height: number } {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const visit = (ring: [number, number][]) => {
    for (const [lon, lat] of ring) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  };
  for (const f of features) {
    if (f.geometry.type === "Polygon") f.geometry.coordinates.forEach(visit);
    else f.geometry.coordinates.forEach((poly) => poly.forEach(visit));
  }
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const s = (width - 2 * PAD) / ((maxLon - minLon) * k);
  return {
    project: (lon, lat) => [PAD + (lon - minLon) * k * s, PAD + (maxLat - lat) * s],
    height: Math.ceil((maxLat - minLat) * s + 2 * PAD),
  };
}

function pathFor(f: CountyFeature, project: Project): string {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  let d = "";
  for (const poly of polys) {
    for (const ring of poly) {
      ring.forEach(([lon, lat], i) => {
        const [x, y] = project(lon, lat);
        d += `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      });
      d += "Z";
    }
  }
  return d;
}

interface PlacedLabel {
  key: string;
  x: number;
  y: number;
  dot: [number, number];
  anchor: "start" | "end";
  text: string;
  kind: "city" | "origin" | "soon";
}

/** City and place names: on their side of the dot (right unless the city says left), else the
 * other side, else below; never over each other or out of the map (widths estimated from the
 * root size, the names are short). */
function placeLabels(
  points: { key: string; x: number; y: number; text: string; kind: PlacedLabel["kind"]; side?: "start" | "end" }[],
  width: number,
  height: number,
  size: number,
): PlacedLabel[] {
  const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const out: PlacedLabel[] = [];
  for (const p of points) {
    const w = p.text.length * size * (p.kind === "soon" ? 0.6 : 0.56);
    const ring = p.kind === "city" ? 3 : 8;
    const tries: { dx: number; dy: number; anchor: "start" | "end" }[] = [
      { dx: ring + 4, dy: size * 0.34, anchor: "start" },
      { dx: -(ring + 4), dy: size * 0.34, anchor: "end" },
      { dx: -(ring + 2), dy: ring + size * 1.05, anchor: "end" },
      { dx: ring + 2, dy: ring + size * 1.05, anchor: "start" },
      { dx: ring + 2, dy: -(ring + 3), anchor: "start" },
      { dx: -(ring + 2), dy: -(ring + 3), anchor: "end" },
    ];
    if (p.side === "end") tries.unshift(...tries.splice(1, 1));
    for (const t of tries) {
      const x = p.x + t.dx;
      const y = p.y + t.dy;
      const box = { x0: t.anchor === "start" ? x : x - w, y0: y - size * 0.8, x1: t.anchor === "start" ? x + w : x, y1: y + size * 0.25 };
      if (box.x0 < 0 || box.x1 > width || box.y0 < 0 || box.y1 > height) continue;
      if (taken.some((b) => box.x0 < b.x1 && b.x0 < box.x1 && box.y0 < b.y1 && b.y0 < box.y1)) continue;
      taken.push(box);
      out.push({ key: p.key, x, y, dot: [p.x, p.y], anchor: t.anchor, text: p.text, kind: p.kind });
      break;
    }
  }
  return out;
}

/**
 * Clickable map of the 21 counties; values are keyed by county name (as in DZS and HZZO data).
 * Drawn 1 unit = 1 px from the column width, so names follow A / A+ / A++. Counties are buttons;
 * the user's county, the selected one, the one pointed at and the focused one get their ink edge in
 * a layer above the fills, where no neighbour can cover it (focus: a yellow marker under the ink).
 * Paths carry data-county for the page's linked highlight ([data-linked]).
 */
export function CountyMap({
  values,
  selected,
  onSelect,
  ariaLabel,
  emptyLabel = "nema podataka",
  origin = null,
  marks = NO_MARKS,
  onHot,
  hot = null,
}: {
  values: Record<string, CountyValue>;
  selected: string | null;
  onSelect: (county: string) => void;
  ariaLabel: string;
  emptyLabel?: string;
  /** The user's county: an ink edge of 1.8 px. */
  origin?: string | null;
  marks?: MapMark[];
  /** The county under the pointer or the keyboard focus, for a list beside the map. */
  onHot?: (county: string | null, focused: boolean) => void;
  /** A county pointed at or focused in that list: its edge is drawn here too. */
  hot?: string | null;
}) {
  const shapes = useQuery({ queryKey: ["counties"], queryFn: api.counties, staleTime: Infinity });
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const width = useElementWidth(wrap, 420);
  const root = useRootFontSize();
  const [tip, setTip] = useState<{ name: string; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);
  const hatch = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const geo = useMemo(() => {
    const features = shapes.data?.features ?? [];
    if (!features.length) return null;
    const { project, height } = makeProjection(features, width);
    const paths = features
      .map((f) => ({ name: f.properties.name, d: pathFor(f, project) }))
      .sort((a, b) => a.name.localeCompare(b.name, "hr"));
    const size = root * 0.72;
    const named = new Set(marks.map((m) => m.label.split(" · ")[0]));
    const labels = placeLabels(
      [
        ...marks.map((m) => {
          const [x, y] = project(m.lon, m.lat);
          return { key: `${m.kind}-${m.label}`, x, y, text: m.label, kind: m.kind };
        }),
        ...CITIES.filter((c) => !named.has(c.name)).map((c) => {
          const [x, y] = project(c.lon, c.lat);
          return { key: c.name, x, y, text: c.name, kind: "city" as const, side: c.side };
        }),
      ],
      width,
      height,
      size,
    );
    return { height, paths, byName: new Map(paths.map((p) => [p.name, p.d])), labels };
  }, [shapes.data, width, root, marks]);

  // The page marks the county of the institution pointed at elsewhere with [data-linked]; its
  // edge is drawn above the neighbours like the others.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const observer = new MutationObserver(() => {
      setLinked(el.querySelector(".county[data-linked]")?.getAttribute("data-county") ?? null);
    });
    observer.observe(el, { subtree: true, attributes: true, attributeFilter: ["data-linked"] });
    return () => observer.disconnect();
  }, [geo]);

  useEffect(() => {
    onHot?.(focus ?? hover, focus !== null);
  }, [hover, focus, onHot]);

  function showTip(name: string, el: Element, clientX?: number, clientY?: number) {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    const r = el.getBoundingClientRect();
    setTip({ name, x: (clientX ?? r.left + r.width / 2) - box.left, y: (clientY ?? r.top + r.height / 2) - box.top });
  }

  function onKey(e: KeyboardEvent, name: string) {
    // A key on a county that was clicked (focused without the marker) brings the marker.
    if (focus !== name && e.key !== "Tab") setFocus(name);
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(name);
    }
  }

  if (shapes.isPending) {
    return (
      <div className="map" ref={wrap}>
        <span className="skeleton map__sk" />
        <span className="visually-hidden">Učitavanje karte…</span>
      </div>
    );
  }
  if (!geo) {
    return (
      <div className="map" ref={wrap}>
        <p className="runin">
          <b>Karta trenutno nije dostupna.</b> Medijani po županijama su u&nbsp;popisu.
        </p>
      </div>
    );
  }

  const edges: { name: string; kind: "origin" | "hot" | "focus" }[] = [];
  if (origin && geo.byName.has(origin)) edges.push({ name: origin, kind: "origin" });
  for (const name of new Set([selected, linked, hover, hot])) {
    if (name && geo.byName.has(name)) edges.push({ name, kind: "hot" });
  }
  if (focus && geo.byName.has(focus)) edges.push({ name: focus, kind: "focus" });
  // The tooltip's anchor slides along its width as the point moves across the map, so a tooltip
  // narrower than the map always stays inside it (left-aligned at the left edge, right at the right).
  const tipX = tip ? `${(-Math.min(1, Math.max(0, tip.x / width)) * 100).toFixed(1)}%` : "0%";

  return (
    <div className="map" ref={wrap} onMouseLeave={() => setTip(null)}>
      <svg
        ref={svg}
        className="map__svg"
        width={width}
        height={geo.height}
        viewBox={`0 0 ${width} ${geo.height}`}
        role="group"
        aria-label={ariaLabel}
      >
        <defs>
          {/* Counties without a value are hatched, so "no data" never looks like a low value. */}
          <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" className="map__hatch-bg" />
            <line x1="0" y1="0" x2="0" y2="6" className="map__hatch-line" />
          </pattern>
        </defs>
        {geo.paths.map((p) => {
          const v = values[p.name];
          return (
            <path
              key={p.name}
              d={p.d}
              className="county"
              data-county={p.name}
              style={{ fill: v ? v.fill : `url(#${hatch})` }}
              role="button"
              tabIndex={0}
              aria-label={`${p.name}${p.name === origin ? " (vaša županija)" : ""}: ${v?.label ?? emptyLabel}`}
              aria-pressed={selected === p.name}
              onClick={() => onSelect(p.name)}
              onKeyDown={(e) => onKey(e, p.name)}
              onMouseEnter={() => setHover(p.name)}
              onMouseLeave={() => setHover(null)}
              onMouseMove={(e) => showTip(p.name, e.currentTarget, e.clientX, e.clientY)}
              onFocus={(e) => {
                // Yellow is the keyboard's: a click focuses the county too, but its
                // only mark is the selected edge and the bold row in the list.
                if (!e.currentTarget.matches(":focus-visible")) return;
                setFocus(p.name);
                showTip(p.name, e.currentTarget);
              }}
              onBlur={() => {
                setFocus(null);
                setTip(null);
              }}
            />
          );
        })}
        <g aria-hidden="true">
          {edges.map((e) =>
            e.kind === "focus" ? (
              <g key={`focus-${e.name}`}>
                <path className="map__edge map__edge--marker" d={geo.byName.get(e.name)} />
                <path className="map__edge map__edge--hot" d={geo.byName.get(e.name)} />
              </g>
            ) : (
              <path key={`${e.kind}-${e.name}`} className={`map__edge map__edge--${e.kind}`} d={geo.byName.get(e.name)} />
            ),
          )}
          {geo.labels.map((l) => (
            <g key={l.key}>
              {l.kind === "city" ? null : (
                <circle cx={l.dot[0]} cy={l.dot[1]} r={7} className={l.kind === "soon" ? "map__soon" : "map__origin"} />
              )}
              <circle cx={l.dot[0]} cy={l.dot[1]} r={2.6} className="map__dot" />
              <text x={l.x} y={l.y} textAnchor={l.anchor} className={`map__city${l.kind === "soon" ? " map__city--soon" : ""}`}>
                {l.text}
              </text>
            </g>
          ))}
        </g>
      </svg>
      {tip ? (
        <div
          className="tooltip map__tip"
          style={{ left: tip.x, top: tip.y, transform: `translate(${tipX}, calc(-100% - 14px))` }}
          role="presentation"
        >
          <strong>{tip.name}</strong>
          {values[tip.name]?.label ?? emptyLabel}
        </div>
      ) : null}
    </div>
  );
}
