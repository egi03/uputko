import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, Mic, Pill } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import { Comparison } from "../components/Comparison";
import { Ac } from "../components/Typeset";
import { fmt, fmtInt, NBSP, plural, stampYearHr } from "../format";
import { useTitle } from "../hooks/useTitle";
import type { WaitingExample } from "../types";
import { exampleLink, exampleTitle } from "../waiting";

/**
 * The front page: a short title, the three things one can do (a few words
 * each) and, beside them, a real case from the current lists that shows the point: the same
 * examination, months sooner nearby.
 */
export function HomePage() {
  useTitle("Kraće čekanje na pregled");
  const examples = useQuery({ queryKey: ["waiting-examples"], queryFn: api.waitingExamples, staleTime: 10 * 60_000 });
  const [first, ...more] = examples.data?.examples ?? [];
  return (
    <section className="home" aria-labelledby="home-h">
      <h1 id="home-h" className="home__h">
        Kraće čekanje na pregled
      </h1>
      {first ? (
        <Example example={first} more={more} updatedAt={examples.data?.updated_at ?? null} />
      ) : examples.isPending ? (
        <div className="ex ex--wait" aria-busy="true">
          <span className="visually-hidden">Učitavanje primjera…</span>
          <span className="skeleton ex__sk" />
        </div>
      ) : null}
      <nav className="choices" aria-label="Što trebate">
        <Choice to="/termini" icon={<CalendarClock />} title="Pronađi kraće čekanje" sub="pregled ili pretraga" />
        <Choice to="/lijekovi" icon={<Pill />} title="Provjeri lijek" sub="recept, doplata, nestašica" />
        <Choice to="/asistent" focusMic icon={<Mic />} title="Pitaj AI asistenta" sub="glasom ili tekstom" />
      </nav>
    </section>
  );
}

/**
 * The biggest saving on the current lists among common referrals in the larger towns
 * (/api/waiting-times/examples): the nearest appointment and the sooner one within 100 km, the
 * days saved, and the way to the full answer with its contacts. Two more cases follow as one line
 * each. The source line says when the lists were fetched.
 */
function Example({
  example: e,
  more,
  updatedAt,
}: {
  example: WaitingExample;
  more: WaitingExample[];
  updatedAt: string | null;
}) {
  const titleId = useId();
  const km = e.sooner.distance_km;
  return (
    <section className="ex" aria-labelledby={titleId}>
      <p className="ex__kicker">
        Primjer s&nbsp;lista čekanja <Ac end="a">HZZO</Ac>
      </p>
      <h2 className="ex__title" id={titleId}>
        {exampleTitle(e)}
        <span className="ex__place"> · {e.location.name}</span>
      </h2>
      <Comparison nearest={e.nearest} sooner={e.sooner} />
      <p className="ex__saving">
        <b>
          {fmtInt(e.saving_days)}
          {NBSP}
          {plural(e.saving_days, "dan", "dana", "dana")} ranije
        </b>
        {km !== null && km >= 2 ? `, oko ${fmt(km)}${NBSP}km od mjesta ${e.location.name}` : ""}.
      </p>
      <p className="ex__acts">
        <Link className="btn" to={exampleLink(e)}>
          Termini i&nbsp;kontakti
          <ArrowRight aria-hidden="true" />
        </Link>
      </p>
      {more.length ? (
        <div className="ex__more">
          <h3 className="ex__more-h">Još primjera</h3>
          <ul>
            {more.map((m) => (
              <li key={`${m.procedure.id}-${m.location.name}`}>
                <Link to={exampleLink(m)}>
                  {exampleTitle(m)}, {m.location.name}
                </Link>
                <span className="ex__more-n">
                  {" "}
                  <span className="num">{fmtInt(m.sooner.wait_days)}</span> umjesto{" "}
                  <span className="num">{fmtInt(m.nearest.wait_days)}</span>
                  {NBSP}
                  {plural(m.nearest.wait_days, "dan", "dana", "dana")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="ex__src">
        Izvor: <Ac>HZZO</Ac>, liste čekanja (<Ac>CEZIH</Ac>){updatedAt ? `, ${stampYearHr(updatedAt)}` : ""}.
        Udaljenost je zračna.
      </p>
    </section>
  );
}

/** One of the three things to do: a large link with an icon, a title and three words. */
function Choice({
  to,
  icon,
  title,
  sub,
  focusMic = false,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  sub: string;
  /** The assistant opens with the focus on its microphone (a voice user is one key away). */
  focusMic?: boolean;
}) {
  return (
    <Link className="choice" to={to} state={focusMic ? { focus: "mic" } : undefined}>
      <span className="choice__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="choice__text">
        <span className="choice__t">{title}</span>
        <span className="choice__s">{sub}</span>
      </span>
      <ArrowRight className="choice__go" aria-hidden="true" />
    </Link>
  );
}
