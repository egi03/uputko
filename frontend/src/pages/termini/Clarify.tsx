/** When /termini cannot answer yet: which place or procedure was meant, or what is near the words. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api } from "../../api";
import { Typeset } from "../../components/Typeset";
import { ProcedureName } from "../../components/waiting/ProcedureName";
import type { ProcedureHit, ToolResponse, WaitingAnswer } from "../../types";
import { countyName, placeNotFound } from "../../waiting";
import { OFTEN } from "./search";

/* ------------------------------------------------------------------ clarifying */

type Candidate = ToolResponse["candidates"][number];

/**
 * Ambiguous or unknown: the tool's question and the candidates as pills. An unknown procedure gets
 * the nearest real names from the list of procedures (or the most searched ones); an unknown
 * place, the same search without a place. Never a dead end.
 */
export function Clarify({
  result,
  summary,
  query,
  linkTo,
  procedureHref,
  oftenHref,
  withoutPlace,
  onPick,
}: {
  result: WaitingAnswer;
  summary: string;
  /** What was typed for the procedure (pretraga), if anything. */
  query: string | undefined;
  linkTo: (c: Candidate) => { search: string };
  procedureHref: (id: number) => { search: string };
  oftenHref: (q: string) => { search: string };
  withoutPlace: { search: string };
  onPick: () => void;
}) {
  const unknownPlace = result.status === "not_found" && placeNotFound(result.summary_hr);
  const unknownProcedure = result.status === "not_found" && !unknownPlace;
  return (
    <section className="tr-clarify" aria-labelledby="clarify-h">
      <h2 className="tr-sec__h" id="clarify-h" tabIndex={-1}>
        Treba pojasniti
      </h2>
      <p className="tr-clarify__q">
        <Typeset text={summary} />
      </p>
      {result.candidates.length ? (
        <ul className="tr-pills" aria-label={result.candidates[0]?.kind === "place" ? "Mjesta" : "Postupci"}>
          {result.candidates.map((c) => (
            <li key={`${c.name}-${c.municipality ?? ""}-${c.county ?? ""}`}>
              <Link className="tr-pill" to={linkTo(c)} onClick={onPick}>
                {c.kind === "place" ? (
                  <>
                    {c.name}
                    {c.county ? <span className="tr-pill__sub">{placeSub(c, result.candidates)}</span> : null}
                  </>
                ) : (
                  <ProcedureName name={c.name} />
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {unknownProcedure ? (
        <ProcedureHints query={query ?? ""} procedureHref={procedureHref} oftenHref={oftenHref} onPick={onPick} />
      ) : null}
      {unknownPlace ? (
        <ul className="tr-pills" aria-label="Bez mjesta">
          <li>
            <Link className="tr-pill" to={withoutPlace} onClick={onPick}>
              Cijela Hrvatska, bez mjesta
            </Link>
          </li>
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Under a place's pill, its county; with the city or municipality where the same name repeats in
 * one county („Luka”: Općina Luka or Grad Vrbovec, both Zagrebačka).
 */
function placeSub(c: Candidate, all: Candidate[]): string {
  const county = countyName(c.county ?? "");
  const twin = all.some((o) => o !== c && o.name === c.name && o.county === c.county);
  return twin && c.municipality ? `${c.municipality} · ${county}` : county;
}

/**
 * Real procedure names near what was typed: the list of procedures searched for the whole text
 * and for the first letters of its two longest words („MR kolena” finds „MR koljena”), ranked by
 * how many of the typed words begin a word of the name, then by how many lists they have.
 */
async function procedureHints(query: string): Promise<ProcedureHit[]> {
  const split = (s: string) =>
    s
      .toLocaleLowerCase("hr")
      .split(/[\s,()·/-]+/u)
      .filter((w) => w.length >= 2);
  const words = split(query);
  const stems = words.map((w) => (w.length > 3 ? w.slice(0, 3) : w));
  const longest = [...words].sort((a, b) => b.length - a.length).slice(0, 2);
  const probes = [...new Set([query.trim(), ...longest.map((w) => (w.length > 3 ? w.slice(0, 3) : w))])].filter(
    (p) => p.length >= 2,
  );
  const found = await Promise.all(probes.map((p) => api.procedures(p).catch(() => [] as ProcedureHit[])));
  const byId = new Map<number, ProcedureHit>();
  for (const hit of found.flat()) byId.set(hit.id, hit);
  const score = (h: ProcedureHit) => {
    const nameWords = split(h.name);
    return stems.filter((s) => nameWords.some((w) => w.startsWith(s))).length;
  };
  return [...byId.values()]
    .map((hit) => ({ hit, s: score(hit) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s || b.hit.institutions - a.hit.institutions)
    .slice(0, 6)
    .map(({ hit }) => hit);
}

function ProcedureHints({
  query,
  procedureHref,
  oftenHref,
  onPick,
}: {
  query: string;
  procedureHref: (id: number) => { search: string };
  oftenHref: (q: string) => { search: string };
  onPick: () => void;
}) {
  const hints = useQuery({
    queryKey: ["procedure-hints", query],
    queryFn: () => procedureHints(query),
    enabled: query.trim().length >= 2,
    staleTime: 5 * 60_000,
  });
  if (query.trim().length >= 2 && hints.isPending) return null;
  const list = hints.data ?? [];
  return (
    <section className="tr-clarify__more" aria-labelledby="hints-h">
      <h3 className="tr-clarify__sub" id="hints-h">
        {list.length ? "Možda tražite" : "Često traženo"}
      </h3>
      <ul className="tr-pills">
        {list.length
          ? list.map((h) => (
              <li key={h.id}>
                <Link className="tr-pill" to={procedureHref(h.id)} onClick={onPick}>
                  <ProcedureName name={h.name} />
                </Link>
              </li>
            ))
          : OFTEN.map((q) => (
              <li key={q}>
                <Link className="tr-pill" to={oftenHref(q)} onClick={onPick}>
                  <Typeset text={q} />
                </Link>
              </li>
            ))}
      </ul>
    </section>
  );
}
