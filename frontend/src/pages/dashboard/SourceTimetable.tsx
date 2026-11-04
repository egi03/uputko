/** The sources' timetable at the end of the dashboard: last download, next one, errors. */
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { api } from "../../api";
import { Typeset } from "../../components/Typeset";
import { dateHr, fmt, fmtInt, NBSP, plural, stampHr } from "../../format";
import type { SourceFreshness } from "../../types";
import { Busy, Failure, SecHead } from "./parts";

/* ================================================================== source timetable */

function intervalLabel(min: number | null): string {
  if (!min) return "samo pri postavljanju";
  if (min < 60) return `svakih ${min}${NBSP}min`;
  if (min < 1440) return `svakih ${fmt(min / 60)}${NBSP}h`;
  if (min === 1440) return "jednom dnevno";
  return `svakih ${fmt(min / 1440)}${NBSP}dana`;
}

/** „prije 19 h”, „prije 2 dana”, from the age the backend measured. */
function ago(min: number | null): string {
  if (min === null) return "";
  if (min < 1) return "upravo sada";
  if (min < 60) return `prije ${min}${NBSP}min`;
  if (min < 48 * 60) return `prije ${Math.round(min / 60)}${NBSP}h`;
  const d = Math.round(min / 1440);
  return `prije ${d}${NBSP}${plural(d, "dan", "dana", "dana")}`;
}

/** The backend's states plus „late”: older than one and a half intervals (stale is past three). */
type State = SourceFreshness["state"] | "late";

const LATE_AFTER = 1.5;

function stateOf(src: SourceFreshness): State {
  if (src.state !== "ok") return src.state;
  const { interval_minutes: every, age_minutes: age } = src;
  return every && age !== null && age > LATE_AFTER * every ? "late" : "ok";
}

const STATE_LABELS: Record<State, string> = { ok: "u redu", late: "kasni", stale: "zastarjelo", error: "greška" };

/**
 * Each source as the credits on the site name it, publisher first („HZZO, liste čekanja
 * (CEZIH)”); the census year where the source itself carries no date. Unknown keys keep the
 * backend's label.
 */
const SOURCE_NAMES: Record<string, { name: string; sub?: string }> = {
  cezih_lists: { name: "HZZO, liste čekanja (CEZIH)" },
  county_boundaries: { name: "DHMZ, granice županija" },
  dzs_municipalities: { name: "DZS, stanovništvo po gradovima i općinama", sub: "Popis 2021." },
  dzs_settlements: { name: "DZS, stanovništvo po naseljima", sub: "Popis 2021." },
  geonames_hr: { name: "GeoNames, naselja" },
  halmed_drugs: { name: "HALMED, baza lijekova" },
  hzzo_drug_lists: { name: "HZZO, osnovna i dopunska lista lijekova" },
  hzzo_hospitals: { name: "HZZO, bolnice i ugovorene djelatnosti" },
  hzzo_pzz: { name: "HZZO, ordinacije primarne zaštite" },
  hzzo_skzz: { name: "HZZO, specijalistička zaštita izvan bolnica" },
};

/** A phrase held on one line: „samo pri postavljanju”, „(prije 3 h)”. */
const tie = (s: string) => s.replaceAll(" ", NBSP);

/** A slash lets „gradovima/općinama” break in a narrow column. */
const breakable = (s: string) => s.replaceAll("/", `/${String.fromCodePoint(0x200b)}`);

/**
 * What went wrong, in Croatian (the backend records exception text in English): a timeout, an
 * HTTP error, no connection, a partial run, a file of a changed shape. The raw text stays in the
 * title for whoever maintains the jobs.
 */
function errorHr(raw: string): string {
  const s = raw.toLowerCase();
  const partial = /(\d+) of (\d+) lists failed/.exec(raw);
  if (partial) return `nije preuzeto ${partial[1]} od ${partial[2]} lista`;
  if (/timed out|timeout/.test(s)) return "izvor se nije javio na vrijeme";
  const http = /error '(\d{3})/i.exec(raw);
  if (http) return `izvor je vratio pogrešku (HTTP ${http[1]})`;
  if (/connect|getaddrinfo|name resolution|unreachable|refused|network/.test(s)) return "veza s izvorom nije uspostavljena";
  if (s.includes("rows, last time")) return "izvor je vratio znatno manje zapisa nego prošli put, pa su zadržani stari podaci";
  if (/valueerror|unexpected|not parsable|header|not found|no export/.test(s)) return "podaci izvora imaju neočekivan oblik";
  return "preuzimanje nije uspjelo";
}

const recordsHr = (n: number) => `${fmtInt(n)}${NBSP}${plural(n, "zapis", "zapisa", "zapisa")}`;

/**
 * Sources read once, at setup, that went well in the same minute, by that minute („28. 10. u
 * 00:43”). In a phone column they share one row: four rows that each said „samo pri
 * postavljanju · u redu” were the longest block of the page. A wide table keeps every source on
 * its own row, and a source that is not in order always keeps its own.
 */
function onceGroups(list: SourceFreshness[]): Map<string, SourceFreshness[]> {
  const groups = new Map<string, SourceFreshness[]>();
  for (const src of list) {
    if (src.interval_minutes || stateOf(src) !== "ok" || !src.last_success_at) continue;
    const at = stampHr(src.last_success_at);
    groups.set(at, [...(groups.get(at) ?? []), src]);
  }
  for (const [at, members] of groups) if (members.length < 2) groups.delete(at);
  return groups;
}

/** „Svih 10 izvora je u redu.”, „Sva 3 izvora su u redu.”; „U redu je 8 od 10 izvora.” otherwise. */
function sourcesSummary(ok: number, all: number): string {
  if (ok < all) return `U redu je ${fmtInt(ok)} od ${fmtInt(all)} izvora.`;
  if (all === 1) return "Izvor je u redu.";
  const few = all % 10 >= 2 && all % 10 <= 4 && (all % 100 < 12 || all % 100 > 14);
  if (few) return `Sva ${fmtInt(all)} izvora su u redu.`;
  return all % 10 === 1 && all % 100 !== 11 ? "Svi izvori su u redu." : `Svih ${fmtInt(all)} izvora je u redu.`;
}

/**
 * „Stanje izvora” as a timetable: when each source was last read and how often. In a phone column
 * the timetable opens with one line that says whether every source is in order and when the last
 * download was; the rows unfold under it, and start unfolded when a source is late, stale or
 * failed. A wide page always shows the whole timetable.
 */
export function SourceTimetable() {
  const query = useQuery({
    queryKey: ["sources"],
    queryFn: api.sources,
    staleTime: 5 * 60_000,
    refetchInterval: 60_000,
  });
  const tableId = useId();
  // null: follow the sources (folded while everything is in order); then the reader's choice.
  const [unfolded, setUnfolded] = useState<boolean | null>(null);
  const list = query.data ?? [];
  const groups = onceGroups(list);
  const grouped = new Set([...groups.values()].flat().map((s) => s.source_key));
  const ok = list.filter((s) => stateOf(s) === "ok").length;
  const open = unfolded ?? ok < list.length;
  const newest = list
    .filter((s) => s.last_success_at && s.age_minutes !== null)
    .sort((a, b) => (a.age_minutes ?? 0) - (b.age_minutes ?? 0))[0];
  return (
    <section className="dsec" id="stanje" aria-labelledby="dash-src" aria-busy={query.isPending}>
      <SecHead id="dash-src" title="Stanje izvora" tag="Osvježava se svake minute" />
      {query.isError ? (
        <Failure title="Stanje izvora trenutno se ne može učitati." onRetry={() => void query.refetch()}>
          Podaci na stranici i&nbsp;dalje se čitaju iz lokalne baze; nedostaje samo pregled preuzimanja.
        </Failure>
      ) : query.isPending ? (
        <>
          <Busy />
          <span className="skeleton dash-sk-table" />
        </>
      ) : list.length === 0 ? (
        <p className="runin">
          <b>Nema podataka.</b> Izvori još nisu preuzeti.
        </p>
      ) : (
        <div className={`dtt${open ? "" : " is-folded"}`}>
          <div className="dtt__fold">
            <p className="dtt__sum">
              <i className={ok < list.length ? "dtt__dot dtt__dot--bad" : "dtt__dot"} aria-hidden="true" />
              <span>
                <b>{sourcesSummary(ok, list.length)}</b>
                {newest?.last_success_at ? (
                  <span className="dtt__newest">
                    Najnovije preuzimanje: {stampHr(newest.last_success_at)} {tie(`(${ago(newest.age_minutes)})`)}
                  </span>
                ) : null}
              </span>
            </p>
            <button
              type="button"
              className="btn btn--sm"
              aria-expanded={open}
              aria-controls={tableId}
              onClick={() => setUnfolded(!open)}
            >
              {open ? "Sakrij izvore" : `Prikaži sve izvore (${fmtInt(list.length)})`}
            </button>
          </div>
          <table id={tableId} className="tbl dtt__t">
            <caption className="visually-hidden">Stanje izvora podataka</caption>
            <thead>
              <tr>
                <th scope="col">Izvor</th>
                <th scope="col">Zadnje preuzimanje</th>
                <th scope="col">Osvježava se</th>
                <th scope="col" className="r">
                  Zapisa
                </th>
                <th scope="col" className="dtt__state">
                  Stanje
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((src) => {
                const state = stateOf(src);
                const known = SOURCE_NAMES[src.source_key];
                const sub = src.source_updated_at ? `skup od ${dateHr(src.source_updated_at)}` : known?.sub;
                const when = src.last_success_at
                  ? `${stampHr(src.last_success_at)} ${tie(`(${ago(src.age_minutes)})`)}`
                  : "još nije preuzeto";
                const count = src.record_count !== null ? recordsHr(src.record_count) : null;
                // In a phone column the three middle cells become one line under the name; it
                // breaks between its parts, never inside „samo pri postavljanju”.
                const meta = [when, tie(intervalLabel(src.interval_minutes)), count].filter(Boolean).join(" · ");
                // The row of a group goes where its first source would be.
                const at = src.last_success_at ? stampHr(src.last_success_at) : "";
                const group = grouped.has(src.source_key) ? groups.get(at) : undefined;
                const once =
                  group?.[0] === src ? (
                    <tr key={`once-${at}`} className="dtt__row dtt__row--ok dtt__once">
                      <th scope="row" className="dtt__src">
                        <span className="tbl__name">Učitano jednom, pri postavljanju</span>
                        <span className="dtt__meta">
                          {at} {tie(`(${ago(src.age_minutes)})`)}
                        </span>
                        <ul className="dtt__members">
                          {group.map((g) => {
                            const name = SOURCE_NAMES[g.source_key];
                            return (
                              <li key={g.source_key}>
                                <Typeset text={name?.name ?? breakable(g.label)} />
                                {name?.sub ? `, ${name.sub}` : ""}
                                {g.record_count !== null ? ` · ${recordsHr(g.record_count)}` : ""}
                              </li>
                            );
                          })}
                        </ul>
                      </th>
                      <td className="dtt__state">
                        <span className="dstate dstate--ok">{STATE_LABELS.ok}</span>
                      </td>
                    </tr>
                  ) : null;
                const row = (
                  <tr
                    key={src.source_key}
                    className={`dtt__row dtt__row--${state}${group ? " dtt__row--grouped" : ""}`}
                  >
                    <th scope="row" className="dtt__src">
                      <span className="tbl__name">
                        <Typeset text={known?.name ?? breakable(src.label)} />
                      </span>
                      {sub ? <span className="tbl__sub">{sub}</span> : null}
                      <span className="dtt__meta">{meta}</span>
                    </th>
                    <td className="dtt__at">
                      {src.last_success_at ? (
                        <>
                          <span className="nw">{stampHr(src.last_success_at)}</span>
                          <span className="tbl__sub">{ago(src.age_minutes)}</span>
                        </>
                      ) : (
                        "još nije preuzeto"
                      )}
                    </td>
                    <td className="dtt__every">{intervalLabel(src.interval_minutes)}</td>
                    <td className="r dtt__n">{fmtInt(src.record_count)}</td>
                    <td className="dtt__state">
                      <span className={`dstate dstate--${state}`}>{STATE_LABELS[state]}</span>
                      {state !== "ok" && state !== "late" && src.last_error ? (
                        <span className="tbl__sub" title={src.last_error}>
                          {errorHr(src.last_error)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
                return once ? [once, row] : row;
              })}
            </tbody>
          </table>
          {/* The key explains the rows, so on a phone it folds away with them. */}
          <p className="small dtt__key">
            Stanje je <b>u&nbsp;redu</b> dok je zadnje preuzimanje mlađe od jednog i&nbsp;pol intervala osvježavanja; zatim{" "}
            <b>kasni</b>, a&nbsp;nakon tri intervala je <b>zastarjelo</b>. <b>Greška</b> znači da zadnje preuzimanje nije
            uspjelo. Datum samog skupa podataka, kad ga izvor navodi, piše ispod naziva.
          </p>
        </div>
      )}
      <p className="small dtt__note">
        Uputko čita lokalnu kopiju otvorenih podataka koju osvježavaju zakazani poslovi; tijekom razgovora ništa se ne
        dohvaća s&nbsp;interneta.
      </p>
    </section>
  );
}
