import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight, LocateFixed } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";

import { api } from "../api";
import { PlaceSearch } from "../components/PlaceSearch";
import { ProcedureSearch } from "../components/ProcedureSearch";
import { Typeset } from "../components/Typeset";
import { ProcedureName } from "../components/waiting/ProcedureName";
import { NBSP } from "../format";
import { useLocate } from "../hooks/useLocate";
import { useTitle } from "../hooks/useTitle";
import { placeName, placeParam, procedureLabel, writtenSummary } from "../waiting";
import { Clarify } from "./termini/Clarify";
import { Examples } from "./termini/Examples";
import { LoadError, ResultsSkeleton } from "./termini/parts";
import { Results } from "./termini/Results";
import { OFTEN, type Params, plain, withParams } from "./termini/search";

/**
 * /termini: a short title and the sentence search („Tražim termin za [MR
 * koljena] u blizini mjesta [Vinkovci]”). Without a question: popular searches and today's real
 * cases of a much shorter wait nearby. With one, in the order a visitor needs it: the headline
 * („Za 32 dana umjesto 68”), the suggested appointments with their telephones, „Kako se
 * naručiti?”, every institution in a simple table, and only then the statistics (the median, the
 * map by county, the chart, the trend) and the sources. Everything is in the URL (postupak,
 * pretraga, mjesto), so a link shows the same answer, with that day's lists.
 */
export function TerminiPage() {
  const [params, setParams] = useSearchParams();
  const procedureId = Number(params.get("postupak")) || undefined;
  const query = params.get("pretraga") ?? undefined;
  const place = params.get("mjesto") ?? undefined;
  const asked = procedureId !== undefined || Boolean(query);
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  // A choice that replaces the part of the page it was made in (a candidate, a row of the
  // overview) hands the focus on to the answer's headline once it arrives.
  const focusAnswer = useRef(false);

  // What the visitor did with one answer (a county on the map, „Promijeni” on a phone, a
  // location notice) starts over with every new search.
  const search = `${procedureId ?? ""}|${query ?? ""}|${place ?? ""}`;
  const [view, setView] = useState({ search, county: null as string | null, changing: false, notice: "" });
  if (view.search !== search) setView({ search, county: null, changing: false, notice: "" });

  const answer = useQuery({
    queryKey: ["waiting", procedureId, query, place],
    queryFn: () => api.waitingTimes({ procedureId, procedure: query, location: place }),
    enabled: asked,
    placeholderData: keepPreviousData,
  });
  const result = asked ? answer.data : undefined;
  const resolved = result?.status === "ok" || result?.status === "no_data" ? result : undefined;
  const procedure = resolved?.data.procedure;
  const refreshing = answer.isPlaceholderData;
  useTitle(procedure ? `${procedureLabel(procedure.name)} · liste čekanja` : "Liste čekanja");

  useEffect(() => {
    if (!result || refreshing || !focusAnswer.current) return;
    focusAnswer.current = false;
    document.getElementById(resolved ? "rezultat" : "clarify-h")?.focus();
  }, [result, resolved, refreshing]);

  function update(next: Params) {
    // From the current URL, not the one of the render that started a slow location lookup.
    setParams((current) => withParams(current, next));
  }
  const href = (next: Params) => ({ search: `?${withParams(params, next).toString()}` });

  const { locate, locating } = useLocate(
    (found) => update({ mjesto: placeParam(found.name, found.county, found.municipality) }),
    (message) => setView((v) => ({ ...v, notice: message })),
  );

  // The blanks show what the page is answering; while the next answer loads, what was asked.
  const procText = refreshing && query ? query : procedure ? procedureLabel(procedure.name) : (query ?? "");
  const origin = resolved?.data.origin ?? null;
  const placeText = !place ? "" : refreshing || !origin ? placeName(place) : origin;
  const current = plain(procedure && !refreshing ? procedureLabel(procedure.name) : (query ?? ""));

  // On a phone an answer folds the search into one line („MR koljena · od mjesta Vinkovci”).
  const unclear = result?.status === "ambiguous" || result?.status === "not_found";
  const failed = answer.isError && !result;
  const folded = asked && !unclear && !failed && !view.changing;

  /**
   * „Traži” (or Enter): both blanks as written. A procedure typed but not picked goes as text
   * (pretraga); a place typed but not picked goes as its name, which the answer resolves or asks
   * about. Nothing changed, nothing to do.
   */
  function submit(typed?: string) {
    const [procInput, placeInput] = form.current?.querySelectorAll<HTMLInputElement>('input[role="combobox"]') ?? [];
    const p = (typed ?? procInput?.value ?? "").trim();
    const m = (placeInput?.value ?? "").trim();
    if (!p) {
      procInput?.focus();
      return;
    }
    const next: Params = {};
    if (plain(p) !== plain(procText)) Object.assign(next, { pretraga: p, postupak: undefined });
    if (m !== placeText) next.mjesto = m || undefined;
    if (Object.keys(next).length) update(next);
  }

  function change() {
    flushSync(() => setView((v) => ({ ...v, changing: true })));
    form.current?.querySelector("input")?.focus();
  }

  /** The place's blank, unfolded on a phone and focused (the empty card's „Upišite mjesto”). */
  function askPlace() {
    flushSync(() => setView((v) => ({ ...v, changing: true })));
    form.current?.querySelectorAll<HTMLInputElement>('input[role="combobox"]')[1]?.focus();
  }

  // The summary as a page says it (the tool's text is written to be spoken).
  const summary = result ? writtenSummary(result.summary_hr) : "";
  const noPlace = resolved?.status === "ok" && !resolved.data.origin;

  const [noticeHead, ...noticeRest] = view.notice.split(/(?<=\.) /);

  return (
    <div className="tr">
      <section className={asked ? "tr-top tr-top--asked" : "tr-top"} aria-labelledby="tr-title">
        <h1 className="tr-top__title" id="tr-title">
          Liste čekanja
        </h1>

        <form
          id={formId}
          ref={form}
          className={folded ? "ask-line tr-ask ask-line--folded" : "ask-line tr-ask"}
          role="search"
          aria-label="Traži termin"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="ask-line__s">
            <span className="ask-line__w">Tražim termin za</span>{" "}
            <ProcedureSearch
              variant="slot"
              placeholder="npr. MR koljena"
              initialText={procText}
              onPick={(hit) => update({ postupak: String(hit.id), pretraga: undefined })}
              onSubmitText={(text) => submit(text)}
            />{" "}
            <span className="ask-line__w">u&nbsp;blizini mjesta</span>{" "}
            <span className="ask-line__end">
              <PlaceSearch
                variant="slot"
                label="Vaše mjesto"
                placeholder="npr. Vinkovci"
                initialText={placeText}
                onPick={(hit) => update({ mjesto: placeParam(hit.name, hit.county, hit.municipality) })}
                onSubmitText={() => submit()}
              />
              <button type="submit" className="ask-line__go" aria-label="Traži termin">
                <ArrowRight aria-hidden="true" />
                <span className="ask-line__go-w">Traži</span>
              </button>
            </span>
          </div>
          <p className="ask-line__tools">
            <button type="button" className="linkbtn" onClick={locate} disabled={locating}>
              <LocateFixed aria-hidden="true" />
              <span>{locating ? "Traženje mjesta…" : "Moja lokacija"}</span>
            </button>
            {place ? (
              <button type="button" className="linkbtn" onClick={() => update({ mjesto: undefined })}>
                Bez mjesta
              </button>
            ) : null}
          </p>
          {/* In the page from the start, so a location that could not be found is announced. */}
          <p className={view.notice ? "runin runin--warn ask-line__note" : "visually-hidden"} role="status">
            {view.notice ? (
              <>
                <b>{noticeHead}</b> {noticeRest.join(" ")}
              </>
            ) : null}
          </p>
        </form>

        {folded ? (
          <div className="ask-short">
            <p>
              <b>{procedure && !refreshing ? <ProcedureName name={procedure.name} /> : <Typeset text={query ?? "Odabrani postupak"} />}</b>
              {/* The place goes with its words as one piece (termini.css): a narrow line breaks after
                  the „·”; a long name breaks inside that piece, never off the screen. */}
              {NBSP}·{" "}
              <span className="ask-short__place">
                {place ? (
                  <>
                    od mjesta <b>{placeText}</b>
                  </>
                ) : (
                  "u cijeloj Hrvatskoj"
                )}
              </span>
            </p>
            <button type="button" className="btn btn--sm" aria-controls={formId} aria-expanded="false" onClick={change}>
              Promijeni
            </button>
          </div>
        ) : null}

        {!asked ? (
          <nav className="tr-often" aria-label="Često traženo">
            <ul className="tr-pills">
              {OFTEN.map((q) => (
                <li key={q}>
                  <Link
                    className="tr-pill tr-pill--quiet"
                    to={href({ pretraga: q, postupak: undefined })}
                    aria-current={plain(q) === current ? "true" : undefined}
                  >
                    <Typeset text={q} />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </section>

      <p className="visually-hidden" aria-live="polite">
        {result && !answer.isFetching
          ? `${summary}${noPlace ? " Upišite svoje mjesto pa ćete vidjeti najbliži slobodni termin." : ""}`
          : ""}
      </p>

      {!asked ? (
        <Examples />
      ) : failed ? (
        <LoadError onRetry={() => void answer.refetch()}>Liste čekanja trenutno nisu dostupne.</LoadError>
      ) : !result ? (
        <ResultsSkeleton />
      ) : (
        <div className={refreshing ? "is-refreshing" : undefined} aria-busy={refreshing || undefined}>
          {resolved ? (
            <Results
              key={search}
              result={resolved}
              summary={summary}
              county={view.county}
              onCounty={(county) => setView((v) => ({ ...v, county }))}
              onAskPlace={askPlace}
              locate={locate}
              locating={locating}
            />
          ) : (
            <Clarify
              result={result}
              summary={summary}
              query={query}
              linkTo={(c) =>
                c.kind === "place"
                  ? href({ mjesto: placeParam(c.name, c.county, c.municipality) })
                  : href({ pretraga: c.name, postupak: undefined })
              }
              procedureHref={(id) => href({ postupak: String(id), pretraga: undefined })}
              oftenHref={(q) => href({ pretraga: q, postupak: undefined })}
              withoutPlace={href({ mjesto: undefined })}
              onPick={() => {
                focusAnswer.current = true;
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
