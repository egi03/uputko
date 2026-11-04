/** /termini before a question: today's real cases of a much shorter wait nearby. */
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { api } from "../../api";
import { Ac, Typeset } from "../../components/Typeset";
import { fmt, fmtInt, NBSP, plural, stampYearHr } from "../../format";
import { exampleLink, exampleTitle } from "../../waiting";
import { LoadError } from "./parts";

/* ------------------------------------------------------------------ without a question */

/**
 * Without a question: real cases from the current lists of the same examination much sooner
 * nearby (the front page's examples), each a link to its full answer. The national statistics
 * (the longest waits, the quality of the lists) are on /dashboard: interesting, but not a step
 * towards an appointment.
 */
export function Examples() {
  const examples = useQuery({ queryKey: ["waiting-examples"], queryFn: api.waitingExamples, staleTime: 10 * 60_000 });
  const data = examples.data;
  const list = data?.examples ?? [];
  return (
    <section className="tr-band tr-ex" aria-labelledby="ex-h" aria-busy={examples.isPending || undefined}>
      <h2 className="tr-sec__h" id="ex-h">
        Primjeri
      </h2>
      {list.length ? (
        <ul className="tr-ex__list">
          {list.map((e) => (
            <li key={`${e.procedure.id}-${e.location.name}`}>
              <Link className="tr-ex__link" to={exampleLink(e)}>
                <span className="tr-ex__what">
                  {exampleTitle(e)} · {e.location.name}
                </span>
                <span className="tr-ex__nums">
                  <b className="num">{fmtInt(e.sooner.wait_days)}</b> umjesto{" "}
                  <span className="num">{fmtInt(e.nearest.wait_days)}</span>
                  {NBSP}
                  {plural(e.nearest.wait_days, "dan", "dana", "dana")}
                </span>
                <span className="tr-ex__where">
                  <Typeset text={e.sooner.spoken_name} />
                  {e.sooner.distance_km !== null ? `, oko ${fmt(e.sooner.distance_km)}${NBSP}km` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : examples.isError ? (
        <LoadError onRetry={() => void examples.refetch()}>Primjeri trenutno nisu dostupni.</LoadError>
      ) : examples.isPending ? (
        <>
          <span className="skeleton tr-ov__sk" />
          <span className="visually-hidden">Učitavanje…</span>
        </>
      ) : (
        <p className="tr-ex__none">Na listama trenutno nema takvog primjera.</p>
      )}
      <p className="credit tr-credit tr-ov__foot">
        <span>
          <b>Izvor:</b> <Ac>HZZO</Ac>, liste čekanja (<Ac>CEZIH</Ac>)
          {data?.updated_at ? `, ${stampYearHr(data.updated_at)}` : ""}.
        </span>
        <Link className="tr-go" to="/dashboard#liste">
          Statistika lista čekanja
          <ArrowRight aria-hidden="true" />
        </Link>
      </p>
    </section>
  );
}
