import { ArrowRight } from "lucide-react";
import { useMemo, useRef } from "react";

import { fmtInt, monthAfter, NBSP, plural } from "../../format";
import { useElementWidth } from "../../hooks/useElementWidth";
import { useRootFontSize } from "../../hooks/useRootFontSize";
import { textWidth } from "../../measure";
import type { WaitingOverview } from "../../types";
import { ProcedureName } from "./ProcedureName";

const DAY_MS = 86_400_000;
const MONTHS = ["sij.", "velj.", "ožu.", "tra.", "svi.", "lip.", "srp.", "kol.", "ruj.", "lis.", "stu.", "pro."];

interface MonthMark {
  /** Days from today to the first of the month. */
  at: number;
  text: string;
  /** January carries the year. */
  strong: boolean;
  month: number;
}

/** The firsts of the months from today to `span` days ahead (the ruler of the list). */
function monthMarks(span: number): MonthMark[] {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS;
  const marks: MonthMark[] = [];
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  for (;;) {
    if (m === 12) {
      m = 0;
      y += 1;
    }
    const at = Date.UTC(y, m, 1) / DAY_MS - today;
    if (at > span) break;
    marks.push({ at, text: m === 0 ? `${MONTHS[0]} ${y}.` : (MONTHS[m] ?? ""), strong: m === 0, month: m });
    m += 1;
  }
  return marks;
}

/**
 * Procedures with the longest median wait (at least five lists) as a calendar: every bar starts at
 * „danas” on one ruler of months and ends in the month a wait from today would end in, written
 * beside it. The bars are ink (length carries the value; red stays for alarms). Each row is a
 * button; on a wide column the procedure, its bar and its figures share one line. With `selected`
 * the rows say which one is shown (aria-pressed).
 */
export function LongestList({
  longest,
  onPick,
  selected,
  limit = 10,
}: {
  longest: WaitingOverview["longest"];
  onPick: (id: number) => void;
  selected?: number | null;
  limit?: number;
}) {
  const rows = longest.slice(0, limit);
  const span = Math.max(30, ...rows.map((l) => l.median_days)) * 1.05;
  const marks = useMemo(() => monthMarks(span), [span]);
  const ruler = useRef<HTMLSpanElement>(null);
  const width = useElementWidth(ruler, 280);
  const root = useRootFontSize();
  // Labels every month where they fit, else every second, third, sixth month (January always,
  // with its year; where January has no room beside „danas”, the first month after it carries the
  // year); none on top of „danas” or past the end of the ruler. A label starts 3 px after its tick
  // and keeps 0.7 of its size clear of the next one.
  const fs = root * 0.78;
  const px = (at: number) => (at / span) * width;
  const label = (m: { text: string; strong: boolean }) => 3 + textWidth(m.text, fs, { weight: m.strong ? 700 : 400 }) + fs * 0.7;
  const today = textWidth("danas", fs) + fs * 0.7;
  const january = marks.find((m) => m.strong);
  const labelsAt = (step: number, carryYear: boolean): MonthMark[] | null => {
    let wanted = marks.filter((m) => (m.strong || m.month % step === 0) && px(m.at) >= today);
    const yearAfter = january && carryYear && !wanted.includes(january) ? wanted.find((m) => m.at > january.at) : undefined;
    if (january && yearAfter) {
      const year = january.text.split(" ")[1] ?? "";
      wanted = wanted.map((m) => (m === yearAfter ? { ...m, text: `${m.text} ${year}`, strong: true } : m));
    }
    wanted = wanted.filter((m) => px(m.at) + label(m) - fs * 0.7 <= width + 1);
    const fits = wanted.every((m, i) => {
      const before = wanted[i - 1];
      return !before || px(m.at) - px(before.at) >= label(before);
    });
    return fits && wanted.length ? wanted : null;
  };
  // The year where it fits; on the narrowest rulers the months alone (the list writes the year).
  const shown =
    [true, false].flatMap((carry) => [1, 2, 3, 6, 12].map((step) => labelsAt(step, carry))).find((l) => l !== null) ?? [];

  if (!rows.length) {
    return <p className="small">Trenutno nijedan postupak nema barem pet lista sa slobodnim terminom.</p>;
  }
  return (
    <div className="lwait">
      <div className="lwait__axis" aria-hidden="true">
        <span className="lwait__ruler" ref={ruler}>
          <span className="lwait__mon lwait__mon--today">danas</span>
          {shown.map((m) => (
            <span
              key={m.at}
              className={m.strong ? "lwait__mon lwait__mon--b" : "lwait__mon"}
              style={{ left: `${(m.at / span) * 100}%` }}
            >
              {m.text}
            </span>
          ))}
        </span>
      </div>
      <ol className="lwait__list">
        {rows.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              className="lwait__row"
              aria-pressed={selected === undefined ? undefined : selected === l.id}
              onClick={() => onPick(l.id)}
            >
              <span className="lwait__name">
                <ProcedureName name={l.name} />
                <span className="lwait__go" aria-hidden="true">
                  {NBSP}
                  <ArrowRight />
                </span>
              </span>
              <span className="lwait__bar" aria-hidden="true">
                {marks.map((m) => (
                  <i key={m.at} className="lwait__tick" style={{ left: `${(m.at / span) * 100}%` }} />
                ))}
                <span className="lwait__fill" style={{ width: `${(l.median_days / span) * 100}%` }} />
              </span>
              <span className="lwait__n">
                <span className="visually-hidden">: medijan </span>
                <b className="num">{fmtInt(l.median_days)}</b>
                {NBSP}
                {plural(l.median_days, "dan", "dana", "dana")}
              </span>
              <span className="lwait__when">
                <span className="visually-hidden">, kraj čekanja: </span>
                {monthAfter(l.median_days)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
