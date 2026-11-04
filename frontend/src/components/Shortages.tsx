import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { api } from "../api";
import { ballsOf, listName } from "../drugs";
import { collator, fmtInt, fold, NBSP, plural, stampYearHr } from "../format";
import type { HzzoList } from "../types";
import { HarveyBall } from "./DrugStatus";

/** How many medicines the list shows before „Prikaži sve”. */
const FIRST = 8;

/** The balls and the words for a list code from HZZO: „● ◐ osnovna i dopunska lista”. */
export function ListWords({ list, hospital = false }: { list: HzzoList | null; hospital?: boolean }) {
  const kinds = ballsOf(list);
  // The balls and the first word never part at a line end.
  const [first, ...rest] = listName(list).split(" ");
  return (
    <span className="lwords">
      <span className="nw">
        <span className="dballs">
          {kinds.map((k) => (
            <HarveyBall key={k} kind={k} />
          ))}
        </span>
        {first}
      </span>
      {rest.length ? ` ${rest.join(" ")}` : ""}
      {hospital ? `, samo u${NBSP}bolnici` : ""}
    </span>
  );
}

/**
 * HALMED's current shortages as a quiet panel: how many, a field that filters the names, and the
 * names from A to Ž, the first eight shown until „Prikaži sve”. A name opens that medicine.
 */
export function Shortages({ onAsk }: { onAsk: (name: string) => void }) {
  const overview = useQuery({ queryKey: ["drug-overview"], queryFn: api.drugOverview, staleTime: 10 * 60_000 });
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  const firstNew = useRef<HTMLButtonElement>(null);
  const fieldId = useId();
  const o = overview.data;

  useEffect(() => {
    if (all) firstNew.current?.focus();
  }, [all]);

  let body;
  if (overview.isPending) {
    body = (
      <>
        <span className="visually-hidden">Učitavanje…</span>
        <span className="skeleton" style={{ height: "3rem", marginTop: "1rem" }} />
        <span className="skeleton" style={{ height: "14rem", marginTop: "1rem" }} />
      </>
    );
  } else if (overview.isError) {
    // The alert and its „Pokušaj ponovno” are in the panel beside (the same request).
    body = <p className="dpanel__lede">Popis će se pojaviti kad pregled ponovno bude dostupan.</p>;
  } else if (!o || o.status === "no_data") {
    body = <p className="dpanel__lede">Baza lijekova HALMED-a još nije preuzeta.</p>;
  } else if (!o.shortages.length) {
    body = (
      <>
        <p className="dpanel__lede">HALMED trenutno ne bilježi nestašicu nijednog lijeka.</p>
        <p className="dsrc">Izvor: HALMED · ažurirano {stampYearHr(o.updated_at)}</p>
      </>
    );
  } else {
    const sorted = [...o.shortages].sort((a, b) => collator.compare(a.label, b.label));
    const q = fold(query);
    const found = q ? sorted.filter((s) => fold(`${s.label} ${s.substance}`).includes(q)) : sorted;
    const shown = q || all ? found : found.slice(0, FIRST);
    const forms = o.shortage_forms ?? sorted.length;
    body = (
      <>
        <p className="dpanel__big">
          <b>{fmtInt(sorted.length)}</b>{" "}
          <span>
            {plural(sorted.length, "lijek", "lijeka", "lijekova")} ({fmtInt(forms)}
            {NBSP}
            {plural(forms, "oblik", "oblika", "oblika")}) u&nbsp;nestašici
          </span>
        </p>
        <div className="field lkfind">
          <label htmlFor={fieldId} className="visually-hidden">
            Pretraži nestašice
          </label>
          <input
            id={fieldId}
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Pretraži po nazivu ili tvari"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="visually-hidden" aria-live="polite">
          {q ? `Pronađeno: ${found.length}.` : ""}
        </p>
        {shown.length ? (
          <ul className="dlist">
            {shown.map((s, i) => (
              <li key={s.label}>
                <button
                  type="button"
                  className="dlist__b"
                  ref={i === FIRST && !q ? firstNew : undefined}
                  onClick={() => onAsk(s.label)}
                >
                  <span className="dlist__t">
                    <span className="dlist__name">{s.label}</span>
                    <span className="dlist__sub">
                      {s.substance.split(/\s*;\s*/).join(", ")}
                      <span className="visually-hidden">, {listName(s.hzzo_list)}</span>
                    </span>
                  </span>
                  <ArrowRight className="dlist__go" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dpanel__lede">Nema nestašice za „{query.trim()}”.</p>
        )}
        {!q && !all && sorted.length > FIRST ? (
          <p className="dpanel__more">
            <button type="button" className="btn btn--sm" onClick={() => setAll(true)}>
              Prikaži sve ({fmtInt(sorted.length)})
            </button>
          </p>
        ) : null}
        <p className="dsrc">Izvor: HALMED · ažurirano {stampYearHr(o.updated_at)}</p>
      </>
    );
  }

  return (
    <section className="dpanel" id="nestasice" aria-labelledby="nestasice-h" aria-busy={overview.isPending}>
      <h2 className="dpanel__h" id="nestasice-h">
        Nestašice
      </h2>
      {body}
    </section>
  );
}
