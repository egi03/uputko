/** Pieces every part of the dashboard (/dashboard) shares: headline, figures, notes, states. */
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

/* ================================================================== shared pieces */

/**
 * Every part of the page opens the same way: a short headline, a pill that says whether its data
 * are real or sample, and (part C) a control at the right end of the line.
 */
export function SecHead({
  id,
  title,
  tag,
  demo = false,
  children,
}: {
  id: string;
  title: ReactNode;
  tag: string;
  /** The pill is hatched: the part shows sample data. */
  demo?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="dsec__head">
      <h2 id={id}>{title}</h2>
      <p className={demo ? "dtag dtag--demo" : "dtag"}>{tag}</p>
      {children ? <div className="dsec__ctl">{children}</div> : null}
    </header>
  );
}

/** A big figure with a few words under it: no tile, no icon. */
export function Figure({ n, children }: { n: ReactNode; children: ReactNode }) {
  return (
    <div className="dnum">
      <dt className="dnum__n">{n}</dt>
      <dd className="dnum__t">{children}</dd>
    </div>
  );
}

/** Notes, method and footnotes fold away under one quiet line („Kako je izračunato”). */
export function More({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="dmore" open={open}>
      <summary>{title}</summary>
      <div className="dmore__body">{children}</div>
    </details>
  );
}

/** A checkbox as a pill: the tick drawn in its box when it is on. */
export function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check__box" aria-hidden="true">
        <svg viewBox="0 0 16 16">
          <path d="M3 8.4 6.4 11.6 13 4.6" />
        </svg>
      </span>
      <span className="check__text">{children}</span>
    </label>
  );
}

/**
 * A section that failed to load: what does not work, and a sentence that stays true whatever else
 * failed with it (the other parts do not depend on it).
 */
export function Failure({ title, children, onRetry }: { title: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div className="runin runin--alert dash-fail" role="alert">
      <p>
        <b>{title}</b> {children}
      </p>
      {onRetry ? (
        <p className="runin__acts">
          <button type="button" className="btn btn--sm" onClick={onRetry}>
            Pokušaj ponovno
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function Busy() {
  return <span className="visually-hidden">Učitavanje…</span>;
}

/**
 * The tooltip of a chart: as wide as its words (up to 18 rem), centred over the point and held
 * inside the chart's column, so a point near either edge never squeezes it into a narrow strip;
 * below the point when there is no room above.
 */
export function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  // Measured before paint whenever the words or the column change; the size is all it needs.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setBox((b) => (b?.w === w && b.h === h ? b : { w, h }));
  }, [children, width]);
  const left = box ? Math.max(0, Math.min(width - box.w, x - box.w / 2)) : x;
  const above = box ? y - box.h - 12 : y;
  const top = box && above < 0 ? y + 14 : above;
  return (
    <div
      ref={ref}
      className="tooltip"
      role="presentation"
      style={{ left, top, visibility: box ? undefined : "hidden" }}
    >
      {children}
    </div>
  );
}
