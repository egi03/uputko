/** The answer on /termini: headline, coupons, „Kako se naručiti?”, the table, then the statistics. */
import { skipToken, useQuery } from "@tanstack/react-query";
import { ArrowRight, LocateFixed, Printer, Share2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../../api";
import { BookingCta } from "../../components/BookingGuide";
import { Coupons } from "../../components/Coupon";
import { TelLink } from "../../components/TelLink";
import { Ac, Typeset } from "../../components/Typeset";
import { CountyWaits } from "../../components/waiting/CountyWaits";
import { ContactLink, EntriesTable, type LeftOut, LeftOutLine } from "../../components/waiting/EntriesTable";
import { ProcedureName } from "../../components/waiting/ProcedureName";
import { WaitScatter } from "../../components/waiting/WaitScatter";
import { WaitTrend } from "../../components/waiting/WaitTrend";
import { dateHr, dayHr, days, fmt, fmtInt, NBSP, plural, stampHr, stampYearHr } from "../../format";
import type { Provider, SourceFreshness, WaitingAnswer, WaitingTrend } from "../../types";
import {
  couponOptions,
  distanceText,
  type HeadlinePart,
  headlineParts,
  insteadParts,
  instKey,
  nearestAndSooner,
  procedureLabel,
} from "../../waiting";

/** Under three lists with a free appointment a „median in Croatia”, its colours, the chart and
 * the map would describe one or two numbers: the page says it in words instead. */
const FEW_LISTS = 3;

/* ------------------------------------------------------------------ the answer */

export function Results({
  result,
  summary,
  county,
  onCounty,
  onAskPlace,
  locate,
  locating,
}: {
  result: WaitingAnswer;
  /** The summary as the page says it (writtenSummary). */
  summary: string;
  county: string | null;
  onCounty: (county: string | null) => void;
  onAskPlace: () => void;
  locate: () => void;
  locating: boolean;
}) {
  const d = result.data;
  const extra = result.extra ?? {};
  const entries = extra.entries ?? [];
  const options = d.options ?? [];
  const coupons = couponOptions(options);
  const origin = d.origin ?? null;
  const pid = d.procedure?.id;
  const name = d.procedure?.name ?? "";
  const label = procedureLabel(name);
  const providers = extra.providers ?? d.other_providers ?? [];
  const childrenOnly: LeftOut[] = extra.children_only ?? [];
  const withoutSlot: LeftOut[] = extra.without_slot ?? [];
  // Institutions with a free appointment, and the lists an adult can use: those with a slot and
  // those without one. A list only for children counts on neither side (it is named under the
  // table), so „25 od 26” compares like with like.
  const free = d.with_free_slot ?? entries.length;
  const lists = extra.without_slot ? free + withoutSlot.length : (d.institutions_on_list ?? free);
  const fewLists = free < FEW_LISTS;
  const median = fewLists ? null : (d.median_days ?? null);
  const parts = headlineParts(options, entries);
  const scale = Math.max(1, median ?? 0, ...entries.map((e) => e.wait_days)) * 1.04;
  const shown = county ? entries.filter((e) => e.county === county) : entries;
  const linked = useLinkedHighlight();
  // Without a place the picks keep a place for the nearest one (no dead end).
  const askForPlace = result.status === "ok" && !origin && coupons.length === 1;
  const updated = result.updated_at ? stampYearHr(result.updated_at) : "";

  const counties = useQuery({
    queryKey: ["waiting-counties", pid],
    queryFn: pid && entries.length > 0 && !fewLists ? () => api.waitingByCounty(pid) : skipToken,
  });
  const trend = useQuery({
    queryKey: ["waiting-trend", pid],
    queryFn: pid && !fewLists ? () => api.waitingTrend(pid) : skipToken,
  });
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: api.sources,
    staleTime: 5 * 60_000,
    enabled: providers.length > 0,
  });
  const mapped = counties.data?.counties.some((c) => c.median_days !== null) ?? false;
  // The section stays when the counties fail to load: it says so, the table works on.
  const mapSection = entries.length > 0 && !fewLists && (counties.isPending || counties.isError || mapped);
  const mapDrawn = mapSection && !counties.isError;
  const snapshots = (trend.data?.days ?? []).filter((t) => t.median_days !== null).length;
  const trendShown = Boolean(pid) && entries.length > 0 && !fewLists && snapshots >= 3;

  // No free appointment anywhere: the lists that exist, nearest first where the place is known.
  const noneList = [...withoutSlot].sort((a, b) =>
    origin ? (a.distance_km ?? Number.POSITIVE_INFINITY) - (b.distance_km ?? Number.POSITIVE_INFINITY) : 0,
  );

  /** A county picked on the map or in its ranking filters the table: the reader is taken there. */
  function pickCounty(next: string | null) {
    onCounty(next);
    if (!next) return;
    requestAnimationFrame(() => {
      const head = document.getElementById("all-h");
      head?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      head?.focus({ preventScroll: true });
    });
  }

  // The answer's point: the nearest appointment against the sooner one beside it.
  const pair = nearestAndSooner(options);
  const headline = pair ? insteadParts(pair.sooner.wait_days, pair.nearest.wait_days) : parts;
  const saving = pair ? pair.nearest.wait_days - pair.sooner.wait_days : 0;
  const soonerKm = pair?.sooner.distance_km ?? null;
  // The statistics come after everything one needs to book: they compare, they do not decide.
  const statsShown = entries.length > 0 && !fewLists;

  return (
    <div className="tr-res" ref={linked}>
      <header className="print-only print-head">
        <p className="print-head__paper">
          Uputko · liste čekanja <Ac end="a">HZZO</Ac> (<Ac>CEZIH</Ac>)
        </p>
        <p className="print-head__title">
          <ProcedureName name={name} />
          {origin ? ` · od mjesta ${origin}` : ""}
        </p>
        <p className="print-head__meta">
          Ispisano {dateHr(new Date().toISOString())}; liste ažurirane {stampHr(result.updated_at)}. Termini se mijenjaju
          svaki dan, a&nbsp;ustanova ih potvrđuje pri naručivanju.
        </p>
      </header>

      <header className="tr-head">
        <h2 className="tr-head__h" id="rezultat" tabIndex={-1}>
          <span className="visually-hidden">
            {label}
            {origin ? `, od mjesta ${origin}` : ""}:{" "}
          </span>
          {headline.length ? <Headline parts={headline} /> : "Danas nema slobodnog termina"}
        </h2>
        {pair ? (
          <p className="tr-head__saving">
            <b>
              {fmtInt(saving)}
              {NBSP}
              {plural(saving, "dan", "dana", "dana")} ranije
            </b>
            {soonerKm !== null && soonerKm >= 2 ? `${NBSP}· ${fmt(soonerKm)}${NBSP}km od mjesta ${origin ?? ""}` : ""}
          </p>
        ) : null}
        <div className="tr-head__meta">
          <p className="tr-src">
            Izvor: <Ac>HZZO</Ac>, liste čekanja (<Ac>CEZIH</Ac>){updated ? ` · ${updated}` : ""}
          </p>
          <ResultActs />
        </div>
      </header>

      {coupons.length ? (
        <section className="tr-picks" aria-labelledby="coupons-h">
          <h3 className="visually-hidden" id="coupons-h">
            Predloženi termini
          </h3>
          {askForPlace ? (
            <div className="tr-pair">
              <Coupons options={options} entries={entries} median={median} />
              <AskCoupon onAskPlace={onAskPlace} locate={locate} locating={locating} />
            </div>
          ) : (
            <Coupons options={options} entries={entries} median={median} />
          )}
          {median !== null ? <ScaleKey median={median} /> : null}
        </section>
      ) : null}

      {/* From a slot to an appointment, right under the slots: who to call, the referral, what
          to bring and what the slot means. */}
      {entries.length || withoutSlot.length ? (
        <BookingCta
          className="tr-book"
          options={coupons.length ? coupons : entries.slice(0, 3)}
          procedure={label}
          updatedAt={result.updated_at}
        />
      ) : null}

      {/* With one or two lists, or none, the summary says what the cards cannot. */}
      {summary && (!coupons.length || fewLists) ? (
        <p className="tr-lede">
          <Typeset text={summary} />
        </p>
      ) : null}

      {/* No free appointment anywhere: the lists that exist, each with its telephone. */}
      {!entries.length && withoutSlot.length ? (
        <section className="tr-none" aria-labelledby="none-h">
          <h3 className="tr-sec__h" id="none-h">
            Ustanove s&nbsp;listom, bez slobodnog termina <span className="tr-count">{fmtInt(withoutSlot.length)}</span>
          </h3>
          <ul className="tr-none__list">
            {noneList.map((w) => {
              const who = w.spoken_name?.trim() || w.institution;
              const where = [w.settlement, origin && w.distance_km != null ? distanceText(w.distance_km) : null]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={instKey(w)}>
                  <span className="tr-none__who">
                    <span className="tbl__name">
                      <Typeset text={who} />
                    </span>
                    {where ? <span className="tbl__sub">{where}</span> : null}
                  </span>
                  <span className="tr-none__tel">
                    <ContactLink phone={w.phone} email={w.email} name={who} />
                  </span>
                </li>
              );
            })}
          </ul>
          <LeftOutLine childrenOnly={childrenOnly} withoutSlot={[]} className="tr-none__kids" />
          <Credit updatedAt={result.updated_at} />
        </section>
      ) : !entries.length ? (
        <LeftOutLine childrenOnly={childrenOnly} withoutSlot={[]} className="tr-kids" />
      ) : null}

      {entries.length ? (
        <div className="tr-band tr-band--all">
          <EntriesTable
            entries={shown}
            total={entries.length}
            free={free}
            hasOrigin={Boolean(origin)}
            median={median}
            scale={scale}
            procedure={label}
            county={county}
            onAllCounties={() => onCounty(null)}
            childrenOnly={childrenOnly}
            withoutSlot={withoutSlot}
          />
          {providers.length ? <Providers providers={providers} /> : null}
          <Credit updatedAt={result.updated_at} distance={Boolean(origin)} />
        </div>
      ) : providers.length ? (
        <Providers providers={providers} />
      ) : null}

      {statsShown ? (
        <section className="tr-stats" aria-labelledby="stats-h">
          <h2 className="tr-stats__h" id="stats-h">
            Statistika
          </h2>
          {free > 0 && median !== null ? (
            <dl className="tr-facts">
              <div>
                <dt>medijan čekanja u&nbsp;Hrvatskoj</dt>
                <dd>
                  <b className="num">{fmtInt(median)}</b> {plural(median, "dan", "dana", "dana")}
                </dd>
              </div>
              <div>
                <dt>
                  {plural(lists, "ustanove", "ustanove", "ustanova")} s&nbsp;listom {plural(free, "ima", "imaju", "ima")}{" "}
                  slobodan termin
                </dt>
                <dd>
                  <b className="num">{fmtInt(free)}</b> od {fmtInt(lists)}
                </dd>
              </div>
            </dl>
          ) : null}

          {mapSection ? (
            <section className="tr-sec tr-map" aria-labelledby="map-h" aria-busy={counties.isPending || undefined}>
              <h3 className="tr-sec__h" id="map-h">
                Po županijama
              </h3>
              {counties.data ? (
                <CountyWaits
                  data={counties.data}
                  selected={county}
                  onSelect={pickCounty}
                  hint="Odaberite županiju za njezine ustanove."
                  originCounty={result.location?.county ?? null}
                  source={
                    <>
                      <Ac>HZZO</Ac> (<Ac>CEZIH</Ac>)
                      {counties.data.updated_at ? `, ${stampYearHr(counties.data.updated_at)}` : ""}
                    </>
                  }
                />
              ) : counties.isError ? (
                <p className="runin tr-map__err">
                  <b>Pregled po županijama trenutno nije dostupan.</b> Tablica ustanova i&nbsp;dalje radi.{" "}
                  <button type="button" className="linkbtn" onClick={() => void counties.refetch()}>
                    Pokušaj ponovno
                  </button>
                </p>
              ) : (
                <>
                  <span className="skeleton tr-map__sk" />
                  <span className="visually-hidden">Učitavanje karte…</span>
                </>
              )}
            </section>
          ) : null}

          {origin ? (
            <section className="tr-sec tr-scatter">
              <WaitScatter
                entries={entries}
                picked={coupons}
                origin={origin}
                median={median}
                procedure={label}
                source={result.source}
                updatedAt={result.updated_at}
                total={free}
                headingLevel={3}
              />
            </section>
          ) : null}

          {trendShown && pid ? (
            <details className="tr-more">
              <summary>Kako se mijenja medijan čekanja</summary>
              <WaitTrend procedureId={pid} />
            </details>
          ) : null}
          <p className="tr-stats__more">
            <Link className="tr-go" to="/dashboard#liste">
              Liste čekanja po županijama za sve postupke
              <ArrowRight aria-hidden="true" />
            </Link>
          </p>
        </section>
      ) : null}

      <section className="tr-notes" aria-labelledby="notes-h">
        <h2 className="tr-notes__h" id="notes-h">
          Izvori i&nbsp;napomene
        </h2>
        <ul>
          <li>
            <Ac>HZZO</Ac>, liste čekanja (<Ac>CEZIH</Ac>){updated ? `, ažurirano ${updated}` : ""}.
          </li>
          {origin && entries.length ? <li>Udaljenost je zračna, između središta naselja.</li> : null}
          {providers.length ? <li>{contractsNote(providers, sources.data)}</li> : null}
          {mapDrawn ? (
            <li>
              Granice županija: <Ac>DHMZ</Ac>, preko Portala otvorenih podataka.
            </li>
          ) : null}
          {trendShown ? <li>{trendNote(trend.data)}</li> : null}
        </ul>
      </section>
    </div>
  );
}

/** The headline with its figures in tabular numerals: „Najbliže za 70 dana, u blizini već za 34”. */
function Headline({ parts }: { parts: HeadlinePart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <span key={i} className="tr-head__n">
            {fmtInt(p.n)}
          </span>
        ),
      )}
    </>
  );
}

/** „Izvor: HZZO, liste čekanja (CEZIH), 29. 10. 2026. u 17:19.” under a data view. */
function Credit({ updatedAt, distance = false }: { updatedAt: string | null; distance?: boolean }) {
  return (
    <p className="credit tr-credit">
      <b>Izvor:</b> <Ac>HZZO</Ac>, liste čekanja (<Ac>CEZIH</Ac>)
      {updatedAt ? `, ${stampYearHr(updatedAt)}` : ""}.{distance ? " Udaljenost je zračna." : ""}
    </p>
  );
}

/** What the colour of a card's number and of a bar means: the wait against the Croatian median. */
function ScaleKey({ median }: { median: number }) {
  return (
    <p className="wkey" aria-hidden="true">
      <span className="wkey__item">
        <i className="wkey__i wkey__i--short" />
        kraće od medijana ({days(median)})
      </span>
      <span className="wkey__item">
        <i className="wkey__i wkey__i--mid" />
        oko medijana
      </span>
      <span className="wkey__item">
        <i className="wkey__i wkey__i--long" />
        dulje
      </span>
    </p>
  );
}

/**
 * Without a place the answer has one card (the soonest in Croatia) and room for one more: the
 * nearest, once the reader gives a place. Nothing in it is data: a question and the two ways to
 * give a place.
 */
function AskCoupon({ onAskPlace, locate, locating }: { onAskPlace: () => void; locate: () => void; locating: boolean }) {
  return (
    <div className="askc">
      <p className="askc__role">Najbliže vama</p>
      <p className="askc__text">Upišite svoje mjesto i&nbsp;ovdje ćete vidjeti najbliži slobodni termin.</p>
      <p className="askc__acts">
        <button type="button" className="btn btn--sm btn--teal" onClick={onAskPlace}>
          Upišite mjesto
        </button>
        <button type="button" className="linkbtn" onClick={locate} disabled={locating}>
          <LocateFixed aria-hidden="true" />
          <span>{locating ? "Traženje mjesta…" : "Moja lokacija"}</span>
        </button>
      </p>
    </div>
  );
}

/**
 * Print the answer (a clean list with every institution's number, styles/print.css) or share its
 * link: the page keeps its state in the URL, so whoever opens it sees the same answer.
 */
function ResultActs() {
  const [note, setNote] = useState("");

  async function share() {
    const url = window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // closed without sharing
      }
    }
    setNote(""); // the same message again is announced again
    try {
      await navigator.clipboard.writeText(url);
      setNote("Poveznica je kopirana.");
    } catch {
      setNote("Kopirajte adresu stranice iz preglednika.");
    }
  }

  return (
    <p className="tr-acts">
      <button type="button" className="linkbtn" onClick={() => window.print()}>
        <Printer aria-hidden="true" />
        <span>Ispiši</span>
      </button>
      <button type="button" className="linkbtn" onClick={() => void share()}>
        <Share2 aria-hidden="true" />
        <span>Podijeli</span>
      </button>
      <span className="tr-acts__note" role="status">
        {note}
      </span>
    </p>
  );
}

/** Institutions with a contract for the service but no published list: call them. */
function Providers({ providers }: { providers: Provider[] }) {
  const one = providers.length === 1;
  return (
    <section className="tr-prov" aria-labelledby="prov-h">
      <h3 className="tr-prov__h" id="prov-h">
        {one ? "Ima" : "Imaju"} ugovor s&nbsp;<Ac end="om">HZZO</Ac>, ali bez liste čekanja
      </h3>
      <ul>
        {providers.map((p) => (
          <li key={`${p.name}-${p.settlement}-${p.address}`}>
            <span>
              <b>
                <Typeset text={p.name} />
              </b>
              <span className="tbl__sub">
                {[p.address, p.settlement].filter(Boolean).join(", ")}
                {p.distance_km === null ? "" : ` · ${distanceText(p.distance_km)}`}
              </span>
            </span>
            {p.phone?.trim() ? <TelLink raw={p.phone} name={p.name} /> : null}
          </li>
        ))}
      </ul>
      <p className="tr-prov__fine">Termin provjerite telefonom.</p>
    </section>
  );
}

const HOSPITAL_KINDS = ["bolnica", "specijalna bolnica"];

/**
 * The note on the contracts: which of HZZO's registers the institutions come from, with the day
 * each register is dated (/api/sources): hospitals, or specialist care outside hospitals.
 */
function contractsNote(providers: Provider[], sources: SourceFreshness[] | undefined): ReactNode {
  const dated = (key: string, what: string) => {
    const iso = sources?.find((s) => s.source_key === key)?.source_updated_at;
    return iso ? `${what} od ${dateHr(iso)}` : what;
  };
  const registers = [
    providers.some((p) => HOSPITAL_KINDS.includes(p.kind_hr)) ? dated("hzzo_hospitals", "bolnica") : null,
    providers.some((p) => !HOSPITAL_KINDS.includes(p.kind_hr))
      ? dated("hzzo_skzz", "specijalističke zaštite izvan bolnica")
      : null,
  ].filter((r): r is string => r !== null);
  const text = registers.join(" i ");
  return (
    <>
      Ustanove s&nbsp;ugovorom: <Ac>HZZO</Ac>, {registers.length > 1 ? "popisi" : "popis"} {text}
      {text.endsWith(".") ? "" : "."}
    </>
  );
}

/** The note on the trend: the portal keeps no history, so the trend grows by one snapshot a day. */
function trendNote(trend: WaitingTrend | undefined): string {
  const snapshots = (trend?.days ?? []).filter((d) => d.median_days !== null);
  const first = snapshots[0]?.day;
  const since = first ? `od ${dayHr(first, true)}` : "svaki dan.";
  return `Trend: portal ne čuva povijest, pa se snimke lista spremaju ${since}`;
}

/**
 * The same institution lights up everywhere it appears in the answer: pointing at or focusing a
 * card, a table row or a dot of the chart marks the others with [data-linked], and the county it
 * is in on the map and in the ranking. One listener for the whole answer, so the parts share no
 * state; they only carry data-inst (and data-county), and each styles its own mark.
 */
function useLinkedHighlight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let lit: Element[] = [];
    let current: string | null = null;
    const clear = () => {
      for (const el of lit) el.removeAttribute("data-linked");
      lit = [];
      current = null;
    };
    const light = (event: Event) => {
      const from = event.target instanceof Element ? event.target.closest("[data-inst]") : null;
      const inst = from?.getAttribute("data-inst") ?? null;
      if (inst === current) return;
      clear();
      if (!inst) return;
      const same = [...root.querySelectorAll(`[data-inst="${CSS.escape(inst)}"]`)];
      const county = same.map((el) => el.getAttribute("data-county")).find(Boolean);
      const area = county ? [...root.querySelectorAll(`[data-county="${CSS.escape(county)}"]:not([data-inst])`)] : [];
      if (same.length + area.length < 2) return;
      current = inst;
      lit = [...same, ...area];
      for (const el of lit) el.setAttribute("data-linked", "");
    };
    root.addEventListener("pointerover", light);
    root.addEventListener("focusin", light);
    root.addEventListener("pointerleave", clear);
    root.addEventListener("focusout", clear);
    return () => {
      clear();
      root.removeEventListener("pointerover", light);
      root.removeEventListener("focusin", light);
      root.removeEventListener("pointerleave", clear);
      root.removeEventListener("focusout", clear);
    };
  }, []);
  return ref;
}
