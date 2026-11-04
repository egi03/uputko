import { type CSSProperties, Fragment, useEffect, useId, useMemo, useRef, useState } from "react";

import { dateHr, days, fmt, fmtInt, NBSP, plural } from "../../format";
import type { WaitOption } from "../../types";
import { countyName, forProcedure, instKey, waitTone } from "../../waiting";
import { TelLink } from "../TelLink";
import { Typeset } from "../Typeset";

type Sort = "km" | "days";
const FIRST_PAGE = 10;

/**
 * An institution the table leaves out: children only, or a list without a free appointment. The
 * contact and the distance come with it where the answer has them.
 */
export interface LeftOut {
  institution_id?: number;
  institution: string;
  settlement: string | null;
  first_slot?: string;
  spoken_name?: string | null;
  phone?: string | null;
  email?: string | null;
  distance_km?: number | null;
}

/**
 * Every institution with a free appointment as a table: the name in the row header, distance, first
 * appointment, a bar in the colour of the scale with a tick at the Croatian median, and the
 * telephone as the action. The first twelve rows show; the rest are rendered as tr.is-extra, hidden
 * on screen only, so a printout lists every institution. Below a width of 42rem (container „tbl”)
 * each row becomes three lines.
 */
export function EntriesTable({
  entries,
  total,
  free,
  hasOrigin,
  median,
  scale,
  procedure,
  county,
  onAllCounties,
  childrenOnly = [],
  withoutSlot = [],
}: {
  /** The rows to show (all of them, or the county chosen on the map). */
  entries: WaitOption[];
  /** How many rows the answer has in all (before a county is chosen). */
  total: number;
  /** How many institutions have a free appointment (more than `total` when the answer holds only
   * the soonest of a very long list). */
  free: number;
  hasOrigin: boolean;
  /** The Croatian median for the procedure: the tick on every bar and the bar's colour. */
  median: number | null;
  /** The days at the right end of a bar, the same for every row and for a county's rows. */
  scale: number;
  /** For the table's caption: "MR koljena". */
  procedure: string;
  county: string | null;
  onAllCounties: () => void;
  childrenOnly?: LeftOut[];
  withoutSlot?: LeftOut[];
}) {
  const sortLabel = useId();
  // Nearest first when the answer has a place, else the shortest wait, unless the visitor chose.
  // Derived, not initial state: the table first mounts with the previous answer while the next
  // one loads (keepPreviousData), so a place added to the search must still sort by distance.
  const [chosen, setSort] = useState<Sort | null>(null);
  const sort: Sort = hasOrigin ? (chosen ?? "km") : "days";
  const [all, setAll] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  const firstNew = useRef<HTMLTableCellElement>(null);
  const focusNew = useRef(false);
  useEffect(() => {
    if (all && focusNew.current) firstNew.current?.focus();
    focusNew.current = false;
  }, [all]);

  const rows = useMemo(() => {
    const far = (e: WaitOption) => e.distance_km ?? Number.POSITIVE_INFINITY;
    const out = [...entries];
    if (sort === "km") out.sort((a, b) => far(a) - far(b) || a.wait_days - b.wait_days);
    else out.sort((a, b) => a.wait_days - b.wait_days || far(a) - far(b));
    return out;
  }, [entries, sort]);
  const hidden = all ? 0 : Math.max(0, rows.length - FIRST_PAGE);
  const tick = median !== null && scale > 0 ? Math.min(1, median / scale) : null;
  const allCounties = (
    <button
      type="button"
      className="linkbtn"
      onClick={() => {
        onAllCounties();
        head.current?.focus(); // the button goes with the filter; the table's headline stays
      }}
    >
      Prikaži sve županije
    </button>
  );

  return (
    <section className="all" aria-labelledby="all-h">
      <div className="all__head">
        <h2 className="all__h" id="all-h" tabIndex={-1} ref={head}>
          Sve ustanove <span className="all__count">{fmtInt(free)}</span>
          <span className="visually-hidden"> sa slobodnim terminom</span>
        </h2>
        {hasOrigin && total > 1 && rows.length > 1 ? (
          <div className="seg all__sort" role="group" aria-labelledby={sortLabel}>
            <span className="visually-hidden" id={sortLabel}>
              Poredaj
            </span>
            <button type="button" aria-pressed={sort === "km"} onClick={() => setSort("km")}>
              Najbliže
            </button>
            <button type="button" aria-pressed={sort === "days"} onClick={() => setSort("days")}>
              Najkraće čekanje
            </button>
          </div>
        ) : null}
      </div>
      {/* The key to the table in one short line (the column heads stay plain words, which a
          screen reader repeats in every cell). */}
      {(tick !== null || free > total) && !(county && !entries.length) ? (
        <p className="small wt__key">
          {free > total
            ? `U tablici ${plural(total, "je", "su", "je")} ${fmtInt(total)} ${plural(total, "ustanova", "ustanove", "ustanova")} s najranijim terminom od njih ${fmtInt(free)}. `
            : null}
          {tick !== null && median !== null ? (
            <>
              <i className="wt__key-tick" aria-hidden="true" /> crtica na traci je medijan u&nbsp;Hrvatskoj ({days(median)})
            </>
          ) : null}
        </p>
      ) : null}
      {/* The county the table shows, in the page from the start so that a county picked on the map
          is announced. A county without a free appointment: one sentence instead of an empty table. */}
      <p className={county ? "runin all__filter" : "visually-hidden"} role="status">
        {county ? (
          <>
            <b>{countyName(county)}:</b>{" "}
            {entries.length ? (
              <>
                {fmtInt(entries.length)} od {fmtInt(total)} {plural(total, "ustanove", "ustanove", "ustanova")} sa
                slobodnim terminom.
              </>
            ) : (
              <>
                nijedna ustanova nema slobodan termin <Typeset text={forProcedure(procedure)} />.
              </>
            )}{" "}
            {allCounties}
          </>
        ) : null}
      </p>
      {county && !entries.length ? null : (
        <>
          <table className="tbl wt">
            <caption className="visually-hidden">
              Ustanove sa slobodnim terminom {forProcedure(procedure)}
              {county ? `, ${countyName(county)}` : ""}, {sort === "km" ? "od najbliže" : "od najkraćeg čekanja"}
            </caption>
            <thead>
              <tr>
                <th scope="col">Ustanova</th>
                {hasOrigin ? (
                  <th scope="col" className="r" aria-sort={sort === "km" ? "ascending" : undefined}>
                    Udaljenost
                  </th>
                ) : null}
                <th scope="col">Prvi termin</th>
                <th scope="col" aria-sort={sort === "days" ? "ascending" : undefined}>
                  Čekanje
                </th>
                <th scope="col">Telefon</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => {
                const tone = waitTone(e.wait_days, median);
                const bar = { "--w": Math.max(0.012, Math.min(1, e.wait_days / scale)) } as CSSProperties;
                return (
                  <tr
                    key={instKey(e)}
                    className={!all && i >= FIRST_PAGE ? "is-extra" : undefined}
                    data-inst={instKey(e)}
                    data-county={e.county ?? undefined}
                  >
                    <th
                      scope="row"
                      ref={i === FIRST_PAGE ? firstNew : undefined}
                      tabIndex={i === FIRST_PAGE ? -1 : undefined}
                    >
                      <span className="tbl__name">
                        <Typeset text={e.spoken_name} />
                      </span>
                      <span className="tbl__sub">{e.settlement ?? "mjesto nije poznato"}</span>
                    </th>
                    {hasOrigin ? <td className="wt__km num r">{distance(e.distance_km)}</td> : null}
                    <td className="wt__date">{dateHr(e.first_slot)}</td>
                    <td className="wt__wait">
                      <span className="wt__w">
                        <span className="wt__bar" style={bar} aria-hidden="true">
                          <i className={`wt__fill wt__fill--${tone}`} />
                          {tick !== null ? <i className="wt__tick" style={{ "--m": tick } as CSSProperties} /> : null}
                        </span>
                        <span className="wt__days">{waitText(e.wait_days)}</span>
                      </span>
                    </td>
                    <td className="wt__tel">
                      <ContactLink phone={e.phone} email={e.email} name={e.spoken_name} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hidden ? (
            <p className="all__more">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  focusNew.current = true;
                  setAll(true);
                }}
              >
                Prikaži sve ({fmtInt(rows.length)})
              </button>
            </p>
          ) : null}
        </>
      )}
      {county ? null : <LeftOutLine childrenOnly={childrenOnly} withoutSlot={withoutSlot} className="all__foot" />}
    </section>
  );
}

function distance(km: number | null) {
  if (km === null) {
    return (
      <>
        <span aria-hidden="true">–</span>
        <span className="visually-hidden">lokacija nije poznata</span>
      </>
    );
  }
  return km < 2 ? "u mjestu" : `${fmt(km)}${NBSP}km`;
}

function waitText(days: number) {
  if (days <= 0) return <b>danas</b>;
  if (days === 1) return <b>sutra</b>;
  return (
    <>
      <b className="num">{fmtInt(days)}</b>
      {NBSP}
      {plural(days, "dan", "dana", "dana")}
    </>
  );
}

/**
 * An institution's way to book: the first telephone number of the source (ink, dialled in full),
 * or the e-mail when the list gives no number. On paper the address is printed instead of the
 * word, broken only after the „@”.
 */
export function ContactLink({
  phone,
  email,
  name,
}: {
  phone?: string | null;
  email?: string | null;
  name: string;
}) {
  if (phone?.trim()) return <TelLink raw={phone} name={name} />;
  if (!email) return null;
  const at = email.indexOf("@");
  return (
    <a className="wt__mail" href={`mailto:${email}`}>
      <span className="wt__mail-word">E-pošta</span>
      <span className="wt__mail-addr">
        <span className="visually-hidden">: </span>
        {at > 0 ? (
          <>
            <span className="nw">{email.slice(0, at + 1)}</span>
            <wbr />
            <span className="nw">{email.slice(at + 1)}</span>
          </>
        ) : (
          email
        )}
      </span>
    </a>
  );
}

/** "Opća bolnica Pula" or "Klinička bolnica Sveti Duh, Zagreb": the place only where the name
 * does not say it, the name as it is said where the answer has it. */
function named(i: LeftOut): string {
  const name = i.spoken_name?.trim() || i.institution;
  const place = i.settlement?.trim();
  return place && !name.toLowerCase().includes(place.toLowerCase()) ? `${name}, ${place}` : name;
}

/**
 * The institutions the table leaves out, in one line: lists only for children (with their first
 * appointment) and lists without a free appointment, each with its telephone where the answer has
 * one. Data the source has, so it is shown rather than dropped.
 */
export function LeftOutLine({
  childrenOnly,
  withoutSlot,
  className,
}: {
  childrenOnly: LeftOut[];
  withoutSlot: LeftOut[];
  className?: string;
}) {
  if (!childrenOnly.length && !withoutSlot.length) return null;
  const contact = (i: LeftOut) =>
    i.phone?.trim() || i.email ? (
      <>
        {" "}
        (<ContactLink phone={i.phone} email={i.email} name={i.spoken_name?.trim() || i.institution} />)
      </>
    ) : null;
  return (
    <p className={className ? `small ${className}` : "small"}>
      {childrenOnly.length ? (
        <>
          <b>Samo za djecu:</b>{" "}
          {childrenOnly.map((c, i) => (
            <Fragment key={instKey(c)}>
              {i ? "; " : ""}
              <Typeset text={named(c)} />
              {c.first_slot ? <> (prvi termin {dateHr(c.first_slot).replace(/ /g, NBSP)})</> : null}
              {contact(c)}
            </Fragment>
          ))}
          .{withoutSlot.length ? " " : ""}
        </>
      ) : null}
      {withoutSlot.length ? (
        <>
          <b>Bez slobodnog termina:</b>{" "}
          {withoutSlot.map((w, i) => (
            <Fragment key={instKey(w)}>
              {i ? "; " : ""}
              <Typeset text={named(w)} />
              {contact(w)}
            </Fragment>
          ))}
          .
        </>
      ) : null}
    </p>
  );
}
