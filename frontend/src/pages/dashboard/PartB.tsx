/** Dashboard part B: waiting lists per county, the longest waits and the lists' quality. */
import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../api";
import { ProcedureSearch } from "../../components/ProcedureSearch";
import { Ac } from "../../components/Typeset";
import { CountyWaits } from "../../components/waiting/CountyWaits";
import { LongestList } from "../../components/waiting/OverviewParts";
import { ProcedureName } from "../../components/waiting/ProcedureName";
import { fmtInt, NBSP, plural, stampYearHr } from "../../format";
import { useReducedMotion } from "../../prefs";
import type { WaitingOverview } from "../../types";
import { procedureLabel } from "../../waiting";
import { Busy, Failure, Figure, More, SecHead } from "./parts";

/* ================================================================== part B: waiting lists */

/** The longest waits under the map: ten, of which five show first. */
const LONGEST = 10;
const LONGEST_FIRST = 5;

/**
 * „O listama”, folded under the map: how complete the lists are and which institutions the county
 * map counts (those with a known location).
 */
function AboutLists({ q }: { q: WaitingOverview["quality"] }) {
  return (
    <p>
      Od {fmtInt(q.entries)} zapisa <b>{fmtInt(q.not_updated)}</b> nema ažuriranu listu, a{" "}
      <b>{fmtInt(q.without_slot)}</b> nema slobodan termin. Karta uzima u&nbsp;obzir samo ustanove s&nbsp;poznatom
      lokacijom, njih <b>{fmtInt(q.institutions_located)}</b> od {fmtInt(q.institutions)}; ostale su uglavnom privatne
      ordinacije.
    </p>
  );
}

type Longest = WaitingOverview["longest"][number];

/**
 * The procedure the map opens on: of the listed longest waits, the one with the most lists. The
 * longest waits are mostly rare procedures with lists in a handful of counties, so the very first
 * of them would leave most of the map hatched; this one colours most counties.
 */
function widestOf(listed: Longest[]): Longest | undefined {
  return listed.reduce<Longest | undefined>((a, b) => (!a || b.institutions > a.institutions ? b : a), undefined);
}

export function PartB({ listsAt }: { listsAt: string | null }) {
  const overview = useQuery({ queryKey: ["waiting-overview"], queryFn: api.waitingOverview });
  const [picked, setPicked] = useState<{ id: number; name: string; median: number | null } | null>(null);
  const [county, setCounty] = useState<string | null>(null);
  const o = overview.data;
  const listed = useMemo(() => o?.longest.slice(0, LONGEST) ?? [], [o]);
  const first = useMemo(() => widestOf(listed), [listed]);
  const pid = picked?.id ?? first?.id ?? null;
  const counties = useQuery({
    queryKey: ["waiting-counties", pid],
    queryFn: pid === null ? skipToken : () => api.waitingByCounty(pid),
  });
  const capRef = useRef<HTMLElement>(null);
  const toMap = useRef(false);
  const reduced = useReducedMotion();
  function pick(id: number, name: string, median: number | null, fromList = false) {
    setPicked({ id, name, median });
    setCounty(null);
    toMap.current = fromList;
  }
  // A procedure picked in the list of longest waits changes the map. Where the map is out of view
  // (on a phone and a tablet the list comes after it), the page takes the reader to the title of
  // the map, and the focus with it, so a screen reader says what the map now shows.
  useEffect(() => {
    if (!toMap.current) return;
    toMap.current = false;
    const cap = capRef.current;
    if (!cap) return;
    const box = cap.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= window.innerHeight) return;
    cap.focus({ preventScroll: true });
    cap.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }, [picked, reduced]);
  // One Croatian median per procedure on the screen. The list beside the map and the search print
  // the median stored when the lists were read; the county endpoint works it out again (today,
  // without lists only for children), which can differ by a day or two. Until the backend uses one
  // definition, the map is compared with the median the reader sees in the list.
  const stored = picked ? picked.median : (first?.median_days ?? null);
  const mapData = useMemo(() => {
    const d = counties.data;
    if (!d || stored === null || d.national.median_days === null || d.national.median_days === stored) return d;
    return { ...d, national: { ...d.national, median_days: stored } };
  }, [counties.data, stored]);
  // The longest waits start with five; „Prikaži više” opens the rest and moves the focus to the
  // first of them.
  const [allLongest, setAllLongest] = useState(false);
  const longRef = useRef<HTMLDivElement>(null);
  const focusLongest = useRef(false);
  const longestTotal = listed.length;
  const longestShown = allLongest ? longestTotal : Math.min(LONGEST_FIRST, longestTotal);
  useEffect(() => {
    const list = longRef.current;
    if (!focusLongest.current) return;
    focusLongest.current = false;
    if (list) list.querySelectorAll("li")[LONGEST_FIRST]?.querySelector<HTMLElement>("button")?.focus();
  }, [allLongest]);
  const updated = o?.updated_at ?? listsAt;
  const busy = overview.isPending || (pid !== null && counties.isPending);
  // The map says which procedure it shows: the field above it is cut short on a phone.
  const mapName = counties.data?.procedure.name ?? picked?.name ?? first?.name ?? null;
  // Counties whose median is the wait on one list (the only one there with a free appointment).
  const single = counties.data?.counties.filter((c) => c.median_days !== null && c.with_free_slot === 1).length ?? 0;
  const why =
    !picked && first
      ? `Karta prvo prikazuje ovaj postupak: ${listed.length === LONGEST ? "od deset najduljih čekanja" : "među najduljim čekanjima"} ima najviše lista.`
      : null;
  const singleNote = single
    ? `U${NBSP}${fmtInt(single)}${NBSP}${plural(single, "županiji", "županije", "županija")} medijan je čekanje na jednoj listi.`
    : null;
  const q = o?.quality;

  return (
    <section className="dsec dsec--band" id="liste" aria-labelledby="dash-b" aria-busy={busy}>
      <SecHead id="dash-b" title="Liste čekanja po županijama" tag="Stvarni podaci" />
      {q && q.entries > 0 ? (
        <dl className="dnums">
          <Figure n={fmtInt(q.institutions)}>
            {plural(q.institutions, "ustanova objavljuje", "ustanove objavljuju", "ustanova objavljuje")} liste čekanja
          </Figure>
          <Figure n={fmtInt(q.procedures_with_lists)}>
            {plural(q.procedures_with_lists, "postupak", "postupka", "postupaka")} s&nbsp;listom
          </Figure>
          <Figure n={fmtInt(q.entries)}>
            {plural(q.entries, "zapis", "zapisa", "zapisa")} na listama
            {updated ? `, ${stampYearHr(updated)}` : ""}
          </Figure>
        </dl>
      ) : null}
      <div className="dproc">
        <ProcedureSearch
          initialText={procedureLabel(picked?.name ?? first?.name ?? "")}
          onPick={(hit) => pick(hit.id, hit.name, hit.median_days)}
        />
      </div>
      {busy ? <Busy /> : null}
      <div className="dmapgrid">
        <div className="dcard dcard--map">
          {overview.isError && pid === null ? (
            <Failure title="Liste čekanja trenutno se ne mogu učitati." onRetry={() => void overview.refetch()}>
              Ostali dijelovi stranice ne ovise o&nbsp;njima.
            </Failure>
          ) : pid !== null ? (
            <figure className="dmap">
              {/* The title stays while a newly picked procedure loads, so the page can lead to it. */}
              <figcaption className="dmap__cap" ref={capRef} tabIndex={-1}>
                {mapName ? (
                  <span className="dmap__title">
                    <ProcedureName name={mapName} />
                  </span>
                ) : null}
              </figcaption>
              {counties.isError ? (
                <Failure title="Karta trenutno nije dostupna." onRetry={() => void counties.refetch()}>
                  {o?.longest.length ? "Popis najduljih čekanja i dalje radi." : null}
                </Failure>
              ) : mapData ? (
                <CountyWaits data={mapData} selected={county} onSelect={setCounty} hint="" />
              ) : (
                <span className="skeleton dash-sk-map" />
              )}
            </figure>
          ) : o && !first ? (
            <p className="runin">
              <b>Nema podataka.</b> Na listama čekanja trenutno nema postupka s&nbsp;dovoljno objavljenih lista.
            </p>
          ) : (
            <span className="skeleton dash-sk-map" />
          )}
        </div>
        <div className="dcard dcard--long">
          <h3>Najdulje se čeka na</h3>
          <p className="small dlong__sub">Medijan dana do prvog slobodnog termina. Odaberite postupak za kartu.</p>
          {o ? (
            o.longest.length ? (
              <div ref={longRef}>
                <LongestList
                  longest={listed}
                  selected={pid}
                  limit={longestShown}
                  onPick={(id) => {
                    const l = listed.find((x) => x.id === id);
                    pick(id, l?.name ?? "", l?.median_days ?? null, true);
                  }}
                />
                {longestTotal > LONGEST_FIRST ? (
                  <button
                    type="button"
                    className="btn btn--sm dlong__more"
                    aria-expanded={allLongest}
                    onClick={() => {
                      focusLongest.current = !allLongest;
                      setAllLongest((v) => !v);
                    }}
                  >
                    {allLongest ? "Prikaži manje" : "Prikaži više"}
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="runin">
                <b>Nema podataka.</b>
              </p>
            )
          ) : overview.isError ? (
            <p className="runin runin--warn">
              <b>Popis trenutno nije dostupan.</b>
            </p>
          ) : (
            <span className="skeleton dash-sk-longest" />
          )}
        </div>
      </div>
      <p className="credit">
        Izvor: <Ac>HZZO</Ac>, liste čekanja (<Ac>CEZIH</Ac>){updated ? `, ažurirano ${stampYearHr(updated)}` : ""}.
      </p>
      {(q && q.entries > 0) || why || singleNote ? (
        <More title="O listama i karti">
          {q && q.entries > 0 ? <AboutLists q={q} /> : null}
          {why || singleNote ? <p>{[why, singleNote].filter(Boolean).join(" ")}</p> : null}
          <p>U&nbsp;popisu najduljih čekanja su postupci s&nbsp;barem pet lista.</p>
        </More>
      ) : null}
    </section>
  );
}
