import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { type CSSProperties, type ReactNode, type SubmitEvent, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api } from "../api";
import { Combobox } from "../components/Combobox";
import { HarveyBall } from "../components/DrugStatus";
import { ExtLink } from "../components/ExtLink";
import { ListWords, Shortages } from "../components/Shortages";
import { HALMED, authorisedOf, ballsOfKind, isOffMarket, isRevoked, type ListKind, listName, listSummary, unavailable } from "../drugs";
import { capitalize, collator, dateHr, euro, fmt, fmtInt, fold, NBSP, nbspHr, plural, stampYearHr, typesetHr } from "../format";
import { useTitle } from "../hooks/useTitle";
import type { DrugAnswer, DrugHit, DrugOverview, DrugProduct } from "../types";

const EXAMPLES = ["Tomid", "Brufen", "Andol", "Ultop", "paracetamol"];


/** A break opportunity that prints nothing. */
const ZWSP = "\u200b";

/** „Piperacilin/Tazobactam” may break after the slash, never inside a word („mg/ml” stays whole). */
const slashBreaks = (text: string): string => text.replace(/(?<=\p{L}{3})\/(?=\p{L}{3})/gu, `/${ZWSP}`);

/** A form's name: it breaks after a slash, and „4 g/0,5 g” keeps each number with its unit. */
const formName = (text: string): string => nbspHr(slashBreaks(text)).replace(/(\d) (?=g\b)/g, `$1${NBSP}`);

/* ------------------------------------------------------------ the page */

/** One short line, under every answer and at the end of the overview. */
function Advice() {
  return (
    <p className="dadvice">Ovdje nema savjeta o&nbsp;primjeni, dozi ni zamjeni lijeka. Pitajte liječnika ili ljekarnika.</p>
  );
}

export function LijekoviPage() {
  const [params, setParams] = useSearchParams();
  // ?lijek= is the page's own parameter; ?q= is accepted for links written the other way.
  const name = (params.get("lijek") ?? params.get("q") ?? "").trim();
  // The answer keeps the name it was asked with: while the next one loads, the previous answer
  // stays on screen and must not take the new name („Prikazano: Brufen (upisano: „Tomid”)”).
  const answer = useQuery({
    queryKey: ["drug", name],
    queryFn: async () => ({ asked: name, result: await api.drugLookup(name) }),
    enabled: name.length > 0,
    placeholderData: keepPreviousData,
  });
  // The day HZZO's lists are in force, for the overview (/api/sources).
  const sources = useQuery({ queryKey: ["sources"], queryFn: api.sources, staleTime: 5 * 60_000 });
  const listsSince = sources.data?.find((s) => s.source_key === "hzzo_drug_lists")?.source_updated_at ?? null;
  const result = name ? answer.data?.result : undefined;
  const asked = answer.data?.asked ?? name;
  const label = result?.status === "ok" ? result.data.label : undefined;
  useTitle(label ? `${label} · lijekovi` : "Lijekovi");
  const ask = (value: string) => setParams(value ? { lijek: value } : {});

  // A row that opens a medicine disappears with its list: focus goes to the answer.
  const fromList = useRef(false);
  const askFromList = (value: string) => {
    fromList.current = true;
    ask(value);
  };
  const settled = (result !== undefined && !answer.isPlaceholderData) || answer.isError;
  useEffect(() => {
    if (!fromList.current || !settled) return;
    fromList.current = false;
    const answerBox = document.getElementById("drug-answer");
    answerBox?.focus({ preventScroll: true });
    answerBox?.scrollIntoView({ block: "start" });
  }, [settled, result]);

  return (
    <div className="drugs">
      <Hero name={name} onAsk={ask} />
      <p className="visually-hidden" aria-live="polite">
        {answer.isFetching || !result ? "" : announce(result, asked)}
      </p>
      <div className="dband">
        {name ? (
          <>
            <div
              className={answer.isPlaceholderData ? "dresult is-refreshing" : "dresult"}
              id="drug-answer"
              tabIndex={-1}
              aria-busy={answer.isFetching}
            >
              {result ? (
                <Answer result={result} name={asked} onAsk={askFromList} />
              ) : answer.isError ? (
                <div className="lkcard" role="alert">
                  <h2 className="lkcard__title">Provjera lijeka trenutno ne radi</h2>
                  <p className="lkcard__lede">Pokušajte ponovno za minutu. Liste čekanja rade i&nbsp;bez nje.</p>
                  <p className="lkcard__acts">
                    <button type="button" className="btn btn--teal" onClick={() => void answer.refetch()}>
                      Pokušaj ponovno
                    </button>
                    <Link className="btn" to="/termini">
                      Liste čekanja
                    </Link>
                  </p>
                </div>
              ) : (
                <CardSkeleton />
              )}
            </div>
            <Advice />
          </>
        ) : (
          <Overview onAsk={askFromList} listsSince={listsSince} />
        )}
      </div>
    </div>
  );
}

/** What the live region reads: a short status. */
function announce(result: DrugAnswer, name: string): string {
  const label = result.data.label ?? name;
  if (result.status === "ok") {
    return result.data.query_kind === "substance"
      ? `Pronađeni su lijekovi s djelatnom tvari ${label}.`
      : `Pronađen je lijek ${label}.`;
  }
  if (result.status === "not_found") return `Lijek „${name}” nije pronađen.`;
  if (result.status === "ambiguous") return "Pronađeno je više sličnih naziva.";
  return "Nema podataka o lijekovima.";
}

/* ------------------------------------------------------------ the top: „Provjeri lijek [___]” */

/** A short title, what the page answers, the sentence to complete with its arrow, a few examples. */
function Hero({ name, onAsk }: { name: string; onAsk: (value: string) => void }) {
  const form = useRef<HTMLFormElement>(null);
  // The arrow sends what is written (Enter does so inside the field); an empty field goes back
  // to the overview.
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = form.current?.querySelector("input")?.value.trim() ?? "";
    if (value || name) onAsk(value);
  };
  return (
    <header className={name ? "dh dh--asked" : "dh"}>
      <h1 className="dh__title">Lijekovi</h1>
      <form ref={form} className="ask-line dh__form" role="search" aria-label="Traži lijek" onSubmit={submit}>
        <div className="ask-line__s dh__line">
          <span className="ask-line__w dh__w">Provjeri lijek</span>{" "}
          {/* The blank and its arrow keep together: the arrow never drops to a line of its own. */}
          <span className="dh__blank">
            <Combobox<DrugHit>
              variant="slot"
              label="Naziv lijeka ili djelatna tvar"
              placeholder="npr. Tomid"
              queryKey="drugs"
              search={api.drugs}
              optionKey={(o) => o.label}
              optionText={(o) => o.label}
              onPick={(o) => onAsk(o.label)}
              onSubmitText={onAsk}
              initialText={name}
              listLabel="Pronađeni lijekovi"
              countText={(n) => `Pronađeno: ${n}. Odaberite strelicama.`}
              renderOption={(o) => (
                <span className="combo__text">
                  <strong>{o.label}</strong>
                  <span className="combo__meta">
                    {o.substance.split(/\s*;\s*/).join(", ")}
                    {o.rx ? ` · ${o.rx}` : ""}
                    {` · ${listName(o.hzzo_list)}`}
                  </span>
                </span>
              )}
            />
            <button type="submit" className="dh__go" aria-label="Provjeri">
              <ArrowRight aria-hidden="true" />
            </button>
          </span>
        </div>
      </form>
      <ul className="dh__ex" aria-label="Primjeri">
        {EXAMPLES.map((q) => (
          <li key={q}>
            <Link
              className="dchip"
              to={{ search: `?lijek=${encodeURIComponent(q)}` }}
              aria-current={fold(name) === fold(q) ? "true" : undefined}
            >
              {q}
            </Link>
          </li>
        ))}
      </ul>
    </header>
  );
}

/* ------------------------------------------------------------ the page without a query */

function Overview({ onAsk, listsSince }: { onAsk: (name: string) => void; listsSince: string | null }) {
  const overview = useQuery({ queryKey: ["drug-overview"], queryFn: api.drugOverview, staleTime: 10 * 60_000 });
  const o = overview.data;
  return (
    <>
      <div className="dpanels">
        <section className="dpanel" aria-labelledby="liste-h" aria-busy={overview.isPending}>
          <h2 className="dpanel__h" id="liste-h">
            Liste HZZO-a
          </h2>
          {overview.isPending ? (
            <>
              <span className="visually-hidden">Učitavanje…</span>
              <span className="skeleton" style={{ height: "3rem", marginTop: "1rem" }} />
              <span className="skeleton" style={{ height: "9rem", marginTop: "1rem" }} />
            </>
          ) : overview.isError ? (
            // One alert for both panels: the shortages come from the same request.
            <div role="alert">
              <p className="dpanel__lede">Pregled lista i&nbsp;nestašica trenutno nije dostupan.</p>
              <p className="lkcard__acts">
                <button type="button" className="btn btn--sm" onClick={() => void overview.refetch()}>
                  Pokušaj ponovno
                </button>
              </p>
            </div>
          ) : o ? (
            <ListsFigure o={o} listsSince={listsSince} />
          ) : null}
        </section>
        <Shortages onAsk={onAsk} />
      </div>
      <Advice />
    </>
  );
}

/** „Neki su oblici na objema listama”: the basic and the supplementary counts overlap. */
function ListsFigure({ o, listsSince }: { o: DrugOverview; listsSince: string | null }) {
  if (o.status === "no_data" || !o.lists || o.total === null || o.on_lists === null || !o.total) {
    return <p className="dpanel__lede">Baza lijekova HALMED-a još nije preuzeta.</p>;
  }
  const off = o.total - o.on_lists;
  const share = `${((o.on_lists / o.total) * 100).toFixed(1)}%`;
  const forms = (n: number) => plural(n, "oblik", "oblika", "oblika");
  const since = dateHr(listsSince);
  return (
    <>
      <p className="dpanel__big">
        <b>{fmtInt(o.on_lists)}</b>{" "}
        <span>
          od {fmtInt(o.total)} {forms(o.total)} lijekova je na listama
        </span>
      </p>
      <div
        className="dbar"
        role="img"
        aria-label={`${fmtInt(o.on_lists)} ${forms(o.on_lists)} na listama HZZO-a, ${fmtInt(off)} nije, od ${fmtInt(o.total)} u bazi HALMED-a`}
      >
        <span className="dbar__on" style={{ "--p": share } as CSSProperties} />
      </div>
      <ul className="lkkey">
        <li>
          <HarveyBall kind="oll" />
          <span>
            Osnovna lista <span className="lkkey__sub">uz recept bez doplate</span>
          </span>
          <b>{fmtInt(o.lists.oll)}</b>
        </li>
        <li>
          <HarveyBall kind="dll" />
          <span>
            Dopunska lista <span className="lkkey__sub">uz recept s&nbsp;doplatom</span>
          </span>
          <b>{fmtInt(o.lists.dll)}</b>
        </li>
        <li>
          <HarveyBall kind="none" />
          <span>Nije na listama</span>
          <b>{fmtInt(o.lists.none)}</b>
        </li>
      </ul>
      <p className="dsrc">
        Broje se oblici lijeka; neki su na objema listama.
        <br />
        Izvor: HALMED, HZZO{since ? ` · liste od ${since}` : ""}
      </p>
    </>
  );
}

/* ------------------------------------------------------------ a result */

function CardSkeleton() {
  return (
    <div className="lkcard">
      <span className="visually-hidden">Učitavanje…</span>
      <span className="skeleton" style={{ height: "3rem", width: "45%" }} />
      <span className="skeleton" style={{ height: "1.2rem", width: "30%", marginTop: "0.8rem" }} />
      <span className="skeleton" style={{ height: "4.5rem", marginTop: "1.6rem" }} />
      <span className="skeleton" style={{ height: "7rem", marginTop: "1.2rem" }} />
    </div>
  );
}

function productsOf(result: DrugAnswer): DrugProduct[] {
  return result.extra?.products ?? result.data.products ?? [];
}

function Answer({ result, name, onAsk }: { result: DrugAnswer; name: string; onAsk: (name: string) => void }) {
  const d = result.data;
  const products = productsOf(result);
  const label = d.label ?? "";
  // The search corrected what was typed („Brufn”): say which medicine the card shows.
  const shown =
    label && fold(label) !== fold(name) ? (
      <p className="dshown">
        Prikazano: <b>{slashBreaks(label)}</b> (upisano: „{name}”)
      </p>
    ) : null;
  if (result.status === "ok" && d.query_kind === "brand" && products.length) {
    return (
      <>
        {shown}
        <DrugCard label={label} products={products} updated={result.updated_at} listsFrom={d.hzzo_lists_in_force_hr ?? null} />
      </>
    );
  }
  if (result.status === "ok" && d.query_kind === "substance" && products.length) {
    return (
      <>
        {shown}
        <SubstanceCard
          label={label}
          summary={result.summary_hr}
          products={products}
          total={d.products_total ?? products.length}
          updated={result.updated_at}
          onAsk={onAsk}
        />
      </>
    );
  }
  if (result.status === "not_found") return <NotFound name={name} onAsk={onAsk} />;
  if (result.status === "ambiguous") {
    return (
      <div className="lkcard">
        <h2 className="lkcard__title">Koji ste lijek mislili?</h2>
        <p className="lkcard__lede">{typesetHr(result.summary_hr)}</p>
        {result.candidates.length ? (
          <Pills label="Mogući lijekovi" names={result.candidates.map((c) => c.name)} onAsk={onAsk} />
        ) : null}
      </div>
    );
  }
  return (
    <div className="lkcard">
      <h2 className="lkcard__title">Nema podataka</h2>
      <p className="lkcard__lede">{typesetHr(result.summary_hr)}</p>
    </div>
  );
}

/** Names as pills; one opens that medicine. */
function Pills({ label, names, onAsk }: { label: string; names: string[]; onAsk: (name: string) => void }) {
  return (
    <ul className="dpills" aria-label={label}>
      {names.map((n) => (
        <li key={n}>
          <button type="button" className="dchip" onClick={() => onAsk(n)}>
            {n}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Not found: what to do next, and the names the search knows that begin the same way. */
function NotFound({ name, onAsk }: { name: string; onAsk: (name: string) => void }) {
  const hits = useQuery({
    queryKey: ["drugs", name],
    queryFn: () => api.drugs(name),
    enabled: name.length >= 2,
    staleTime: 5 * 60_000,
  });
  const names = (hits.data ?? []).map((h) => h.label).slice(0, 6);
  return (
    <div className="lkcard">
      <h2 className="lkcard__title">Lijek nije pronađen</h2>
      <p className="lkcard__lede">
        „{name}” nije pronađen u&nbsp;bazi HALMED-a. Upišite naziv kako piše na kutiji ili djelatnu tvar.
      </p>
      {names.length ? (
        <>
          <h3 className="lkcard__h">Slični nazivi</h3>
          <Pills label="Slični nazivi u bazi" names={names} onAsk={onAsk} />
        </>
      ) : null}
    </div>
  );
}

const unique = <T,>(values: (T | null | undefined)[]): T[] =>
  [...new Set(values.filter((v): v is T => v !== null && v !== undefined && v !== ""))];

/** „torasemid”, „paracetamol, kofein i kodeinfosfat seskvihidrat”. */
function substancesText(products: DrugProduct[]): string {
  const all = unique(products.flatMap((p) => p.active_substance.split(/\s*;\s*/)));
  return all.length > 1 ? `${all.slice(0, -1).join(", ")} i ${all[all.length - 1]}` : (all[0] ?? "");
}

const KINDS = ["ponovljivi", "neponovljivi", "ograničeni", "poseban"];

/** „na recept (ponovljivi)”, „bez recepta”, „neki oblici na recept, neki bez recepta”. */
function rxText(products: DrugProduct[]): string {
  const rx = unique(products.map((p) => p.rx));
  if (rx.length > 1) return "neki oblici na recept, neki bez recepta";
  if (rx[0] === HALMED.otc) return "bez recepta";
  if (rx[0] !== HALMED.rx) return "";
  // The kind of prescription in brackets only when every form has the same, single kind.
  const kinds = products.map((p) => {
    const found = KINDS.filter((k) => new RegExp(`(^|\\s)${k} recept`).test(p.prescription ?? ""));
    return found.length === 1 ? found[0] : null;
  });
  const one = unique(kinds);
  return one.length === 1 && kinds.every(Boolean) ? `na recept (${one[0]})` : "na recept";
}

/** A form's way of issue: „ponovljivi recept”, „bez recepta”. */
function issuing(p: DrugProduct): string {
  const text = p.rx === HALMED.rx && p.prescription ? p.prescription : (p.rx ?? "nije navedeno");
  return nbspHr(text).replace(/ (?=recepta?\b)/g, NBSP);
}

/** „1,29–1,82 €” or „1,03 €”. */
function copayRange(min: number | null, max: number | null): string | null {
  if (min === null) return null;
  if (max === null || max === min) return euro(min);
  return `${fmt(min, 2)}–${fmt(max, 2)}${NBSP}€`;
}


/** Every product says whether it was revoked: then counts agree exactly with the summary. */
const flagged = (products: DrugProduct[]): boolean =>
  products.length > 0 && products.every((p) => typeof p.revoked === "boolean");

/**
 * The large figure of the card: what the visitor meets at the pharmacy. „nije u prometu” before
 * anything else (a price would suggest it can be had), then the co-payment, what the basic list
 * or the hospital means, or „bez recepta” for a medicine on no list. A prescription medicine on
 * no list has no figure: the facts under the name say it.
 */
interface Figure {
  kind: "market" | "copay" | "list" | "rx";
  n: string;
  label: string;
}

function entryFigure(products: DrugProduct[]): Figure | null {
  const live = authorisedOf(products);
  const gone = unavailable(products);
  if (gone) return { kind: "market", n: "nije u prometu", label: gone };
  const s = listSummary(live);
  const range = s.kind === "dll" || s.kind === "both" ? copayRange(s.copayMin, s.copayMax) : null;
  if (range) {
    return {
      kind: "copay",
      n: range,
      label: s.kind === "both" ? "doplata na dopunskoj listi" : "doplata po pakiranju",
    };
  }
  if (s.kind === "oll") return { kind: "list", n: "bez doplate", label: s.some ? "za oblike na osnovnoj listi" : "uz recept" };
  if (s.kind === "hospital") return { kind: "list", n: "u bolnici", label: "samo za bolničku primjenu" };
  if (s.kind === "none" && live.every((p) => p.rx === HALMED.otc)) {
    return { kind: "rx", n: "bez recepta", label: "nije na listama HZZO-a" };
  }
  return null;
}

/** „za oba oblika”, „1 od 4 oblika”: how much of a medicine a state covers. */
function shareOf(n: number, total: number): string {
  if (n === total) return total === 1 ? "" : total === 2 ? "oba oblika" : "svi oblici";
  return `${n} od ${total}${NBSP}${plural(total, "oblika", "oblika", "oblika")}`;
}

const LIST_FACT: Record<ListKind, string> = {
  oll: "Osnovna lista",
  dll: "Dopunska lista",
  both: "Osnovna i dopunska",
  hospital: "Osnovna lista",
  none: "Nije na listama",
};

/** Supply as HALMED records it, said once and only from what it records. */
function supplyFact(live: DrugProduct[]): { text: string; sub: string; warn: boolean } | null {
  const n = live.length;
  const short = live.filter((p) => p.shortage === HALMED.shortage);
  if (short.length) return { text: "Nestašica", sub: shareOf(short.length, n), warn: true };
  const paused = live.filter((p) => p.market_status === HALMED.paused);
  if (paused.length) return { text: "Privremeni prekid", sub: shareOf(paused.length, n), warn: true };
  const on = live.filter((p) => p.market_status === HALMED.onMarket);
  if (!on.length) return null;
  const out = live.filter(isOffMarket).length;
  const calm = on.every((p) => p.shortage === HALMED.noShortage);
  const sub = out
    ? `${out} od ${n}${NBSP}${plural(n, "oblika", "oblika", "oblika")} ${plural(out, "nije", "nisu", "nije")} u${NBSP}prometu`
    : calm
      ? `bez nestašice`
      : "";
  return { text: "U prometu", sub, warn: false };
}

/**
 * A medicine as one card: the name large, its substance, the figure (co-payment or what the list
 * means), three facts (HZZO list, issuing, supply), the forms and the leaflet on HALMED.
 */
function DrugCard({
  label,
  products,
  updated,
  listsFrom,
}: {
  label: string;
  products: DrugProduct[];
  updated: string | null;
  listsFrom: string | null;
}) {
  const live = authorisedOf(products);
  const s = listSummary(live);
  const figure = entryFigure(products);
  const rx = rxText(live);
  const supply = figure?.kind === "market" ? null : supplyFact(live);
  const link = products.find((p) => p.detail_url)?.detail_url;
  const listSub =
    s.kind === "hospital" ? `samo u${NBSP}bolnici` : s.some && s.kind !== "none" ? "samo neki oblici" : "";

  return (
    <article className="lkcard" aria-labelledby="lkcard-h">
      <div className="lkcard__head">
        <div className="lkcard__id">
          <h2 className="lkcard__name" id="lkcard-h">
            {slashBreaks(label)}
          </h2>
          <p className="lkcard__sub">{substancesText(products)}</p>
        </div>
        {figure ? (
          <p className={`lkcard__fig lkcard__fig--${figure.kind}`}>
            <span className="lkcard__n">{figure.n}</span>
            <span className="lkcard__cap">{figure.label}</span>
          </p>
        ) : null}
      </div>
      <dl className="dfacts">
        <div>
          <dt>Lista HZZO-a</dt>
          <dd>
            <span className="dballs">
              {ballsOfKind(s.kind).map((k) => (
                <HarveyBall key={k} kind={k} />
              ))}
            </span>
            {LIST_FACT[s.kind]}
            {listSub ? <span className="dfacts__sub">{listSub}</span> : null}
          </dd>
        </div>
        {rx && figure?.kind !== "rx" ? (
          <div>
            <dt>Izdavanje</dt>
            <dd>{capitalize(rx)}</dd>
          </div>
        ) : null}
        {supply ? (
          <div>
            <dt>Opskrba</dt>
            <dd className={supply.warn ? "is-warn" : undefined}>
              {supply.text}
              {supply.sub ? <span className="dfacts__sub">{supply.sub}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
      <FormsList products={products} />
      <div className="lkcard__foot">
        {link ? (
          <ExtLink className="btn btn--sm lkcard__leaflet" href={link}>
            Uputa o lijeku (HALMED)
          </ExtLink>
        ) : null}
        <p className="dsrc">
          Izvor: HALMED, HZZO
          {updated ? ` · ažurirano ${stampYearHr(updated)}` : ""}
          {listsFrom ? ` · liste od ${nbspHr(listsFrom)}` : ""}
        </p>
      </div>
    </article>
  );
}

/** A form's co-payment: „1,29–1,82 €”, „bez doplate”, or „–”. */
function copayText(p: DrugProduct): string {
  const kinds = (p.hzzo_list ?? "").split("+");
  const range = kinds.includes("DLL") ? copayRange(p.copay_min_eur, p.copay_max_eur) : null;
  if (range) return range;
  if (p.hzzo_list && !p.hospital_only && !kinds.includes("DLL")) return "bez doplate";
  return "–";
}

/** A form one can get: authorised, and not off the market as far as HALMED says. */
const obtainable = (p: DrugProduct): boolean => !isRevoked(p) && !isOffMarket(p);

/** A form whose state on the market is not the ordinary one. */
function formState(p: DrugProduct): string | null {
  if (isRevoked(p)) return "odobrenje ukinuto";
  if (p.shortage === HALMED.shortage) return "nestašica";
  if (p.market_status === HALMED.paused) return "privremeni prekid opskrbe";
  if (isOffMarket(p)) return "nije u prometu";
  return null;
}

/** The strength a form's name starts with, after the brand: „Prilen 2,5 mg tablete” -> 2.5. */
function strengthOf(p: DrugProduct): number {
  const rest = p.name.startsWith(p.brand) ? p.name.slice(p.brand.length) : p.name;
  const found = /\d+(?:,\d+)?/.exec(rest);
  return found ? Number.parseFloat(found[0].replace(",", ".")) : Number.POSITIVE_INFINITY;
}

/** By form, then by strength (2,5 mg before 5 mg and 10 mg). */
const byForm = (a: DrugProduct, b: DrugProduct): number =>
  Number(isRevoked(a)) - Number(isRevoked(b)) ||
  collator.compare(a.form, b.form) ||
  strengthOf(a) - strengthOf(b) ||
  collator.compare(a.name, b.name);

/**
 * The forms as a plain list. What every form shares is said once in the facts above; a row adds
 * only what sets it apart (issuing, list, co-payment) and a state that is not the ordinary one.
 */
function FormsList({ products }: { products: DrugProduct[] }) {
  const rows = [...products].sort(byForm);
  const varies = (f: (p: DrugProduct) => string) => new Set(products.map(f)).size > 1;
  const showRx = varies(issuing);
  const showList = varies((p) => `${p.hzzo_list ?? ""}${p.hospital_only ? "h" : ""}`);
  // The co-payment only when the listed forms one can get differ in it (a form on no list says so
  // in words). A form that cannot be had shows none, as a medicine that cannot be had (entryFigure).
  const listed = products.filter((p) => p.hzzo_list && obtainable(p));
  const showCopay = new Set(listed.map(copayText)).size > 1;
  return (
    <section className="dforms" aria-labelledby="dforms-h">
      <h3 className="lkcard__h" id="dforms-h">
        {rows.length === 1 ? "Oblik" : "Oblici"} <span className="lkcard__count">{rows.length}</span>
      </h3>
      <ul className="dforms__list">
        {rows.map((p, i) => {
          const state = formState(p);
          const meta: ReactNode[] = [];
          if (showRx) meta.push(issuing(p));
          if (showList) meta.push(<ListWords list={p.hzzo_list} hospital={p.hospital_only} />);
          if (state) meta.push(<b className="dwarn">{state}</b>);
          const copay = showCopay && obtainable(p) ? copayText(p) : null;
          return (
            <li key={`${p.name}-${i}`} className="dforms__row">
              <div className="dforms__main">
                {p.detail_url ? (
                  <ExtLink className="dforms__name" href={p.detail_url}>
                    {formName(p.name)}
                  </ExtLink>
                ) : (
                  <span className="dforms__name">{formName(p.name)}</span>
                )}
                {meta.length ? (
                  <span className="dforms__meta">
                    {meta.map((m, j) => (
                      <span key={j} className="dforms__part">
                        {m}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
              {copay && copay !== "–" ? <span className="dforms__copay">{copay}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------ the names with one substance */

interface BrandRow {
  brand: string;
  live: DrugProduct[];
}

/**
 * The names of a substance in three groups, as the summary counts them: on HZZO's lists, not on
 * the lists, and not on the market. Names whose every form was revoked are named apart. Without
 * the backend's flag a revoked form cannot be told apart, so a listed name whose every form has
 * ended supply goes with those not on the market.
 */
function brandGroups(products: DrugProduct[], exact: boolean) {
  const authorised = authorisedOf(products);
  const byBrand = new Map<string, DrugProduct[]>();
  for (const p of products) byBrand.set(p.brand, [...(byBrand.get(p.brand) ?? []), p]);
  const listed: BrandRow[] = [];
  const unlisted: BrandRow[] = [];
  const away: BrandRow[] = [];
  const gone: string[] = [];
  for (const [brand, forms] of byBrand) {
    const live = forms.filter((p) => authorised.includes(p));
    const onList = exact
      ? live.some((p) => p.hzzo_list)
      : live.some((p) => p.hzzo_list) && !live.every((p) => p.market_status === HALMED.ended);
    if (!live.length) gone.push(brand);
    else if (onList) listed.push({ brand, live });
    else if (live.every(isOffMarket)) away.push({ brand, live });
    else unlisted.push({ brand, live });
  }
  const byName = (a: BrandRow, b: BrandRow) => collator.compare(a.brand, b.brand);
  return {
    listed: listed.sort(byName),
    unlisted: unlisted.sort(byName),
    away: away.sort(byName),
    gone: gone.sort(collator.compare),
  };
}

function SubstanceCard({
  label,
  summary,
  products,
  total,
  updated,
  onAsk,
}: {
  label: string;
  summary: string;
  products: DrugProduct[];
  total: number;
  updated: string | null;
  onAsk: (name: string) => void;
}) {
  const { listed, unlisted, away, gone } = brandGroups(products, flagged(products));
  const groups = [
    { key: "listed", title: "Na listama HZZO-a", rows: listed },
    { key: "unlisted", title: "Nisu na listama", rows: unlisted },
    { key: "away", title: "Nisu u prometu", rows: away },
  ];
  return (
    <article className="lkcard" aria-labelledby="lkcard-h">
      <div className="lkcard__id">
        <h2 className="lkcard__name" id="lkcard-h">
          {slashBreaks(label)}
        </h2>
        <p className="lkcard__sub">djelatna tvar</p>
      </div>
      <p className="lkcard__lede">{typesetHr(summary)}</p>
      {groups.map((g) =>
        g.rows.length ? (
          <section key={g.key} className={`dgroup dgroup--${g.key}`} aria-labelledby={`dgroup-${g.key}`}>
            <h3 className="lkcard__h" id={`dgroup-${g.key}`}>
              {g.title}
            </h3>
            <ul className="dpills">
              {g.rows.map((row) => {
                const s = listSummary(row.live);
                const short = row.live.some((p) => p.shortage === HALMED.shortage);
                return (
                  <li key={row.brand}>
                    <button type="button" className="dchip" onClick={() => onAsk(row.brand)}>
                      {g.key === "listed" ? (
                        <span className="dballs" aria-hidden="true">
                          {ballsOfKind(s.kind).map((k) => (
                            <HarveyBall key={k} kind={k} />
                          ))}
                        </span>
                      ) : null}
                      {row.brand}
                      {short ? <span className="dchip__warn">nestašica</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null,
      )}
      {gone.length ? <p className="dsrc">HALMED je ukinuo odobrenje za {gone.join(", ")}.</p> : null}
      <div className="lkcard__foot">
        <p className="dsrc">
          {total > products.length
            ? `Prikazano je ${products.length} od ${total}${NBSP}${plural(total, "oblika", "oblika", "oblika")}. `
            : ""}
          Izvor: HALMED, HZZO{updated ? ` · ažurirano ${stampYearHr(updated)}` : ""}
        </p>
      </div>
    </article>
  );
}
