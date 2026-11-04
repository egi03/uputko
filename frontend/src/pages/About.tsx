import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Link } from "react-router-dom";

import { api } from "../api";
import { ExtLink } from "../components/ExtLink";
import { PageSection as Section } from "../components/PageSection";
import { Ac } from "../components/Typeset";
import { capitalize, fmtInt, monthYear, NBSP, nbspHr, plural, stampHr } from "../format";
import { useTitle } from "../hooks/useTitle";
import type { SourceFreshness, WaitingOverview } from "../types";

/* ------------------------------------------------------------ refresh intervals in words */

const every = (n: number): string => plural(n, "svaki", "svaka", "svakih");
const hoursWord = (n: number): string => plural(n, "sat", "sata", "sati");

/** Sources without an interval are not on a schedule: they are read once, into a new database. */
const AT_SETUP = "pri postavljanju baze";

/**
 * How often a source is read, from /api/sources (interval_minutes): „svakih 12 sati”. A source
 * without an interval is loaded once, when the database is set up (the seed: census, settlements,
 * county borders). Null when the status is not known.
 */
function refreshPhrase(intervals: (number | null)[]): string | null {
  if (intervals.length === 0) return null;
  const hours = intervals.filter((m): m is number => m != null).map((m) => Math.round(m / 60));
  if (hours.length === 0) return AT_SETUP;
  const lo = Math.min(...hours);
  const hi = Math.max(...hours);
  return lo === hi
    ? `${every(lo)} ${lo}${NBSP}${hoursWord(lo)}`
    : `${every(lo)} ${lo} do ${hi}${NBSP}${hoursWord(hi)}`;
}

/* ------------------------------------------------------------ the sources, as published */

interface SourceMeta {
  key: string;
  /** The data set, in the publisher's words where possible. */
  set: string;
  publisher: string;
  license: ReactNode;
  /** What we use it for; facts only. */
  about?: string;
  /** HZZO registers say which month they describe (source_updated_at): „Popis iz rujna 2026.” */
  edition?: string;
}

const HZZO_LICENSE = (
  <>
    Javna informacija, uz navođenje <Ac end="a">HZZO</Ac>
  </>
);

const SOURCES: SourceMeta[] = [
  { key: "cezih_lists", set: "Liste čekanja (CEZIH)", publisher: "HZZO", license: HZZO_LICENSE },
  {
    key: "hzzo_pzz",
    set: "Ugovorne ordinacije primarne zaštite",
    publisher: "HZZO",
    license: HZZO_LICENSE,
    edition: "Popis",
  },
  {
    key: "hzzo_skzz",
    set: "Specijalistička zaštita izvan bolnica",
    publisher: "HZZO",
    license: HZZO_LICENSE,
    edition: "Popis",
  },
  {
    key: "hzzo_hospitals",
    set: "Bolnička mreža i adresar bolnica",
    publisher: "HZZO",
    license: HZZO_LICENSE,
    edition: "Popis",
  },
  {
    key: "hzzo_drug_lists",
    set: "Osnovna i dopunska lista lijekova",
    publisher: "HZZO",
    license: HZZO_LICENSE,
    edition: "Liste",
  },
  {
    key: "halmed_drugs",
    set: "Baza lijekova",
    publisher: "HALMED",
    license: "Otvorena dozvola",
    about: "Djelatna tvar, način izdavanja, status na tržištu, nestašice i uputa o lijeku.",
  },
  {
    key: "dzs_settlements",
    set: "Popis stanovništva 2021., naselja",
    publisher: "DZS",
    license: "Otvorena dozvola",
    about: "Broj stanovnika po naselju.",
  },
  {
    key: "dzs_municipalities",
    set: "Popis stanovništva 2021., gradovi i općine",
    publisher: "DZS",
    license: "Otvorena dozvola",
    about: "Ukupno stanovnika i stanovnici stariji od 65 godina.",
  },
  {
    key: "geonames_hr",
    set: "Koordinate naselja",
    publisher: "GeoNames",
    license: `CC${NBSP}BY 4.0`,
    about: `Pokriva 99${NBSP}% naselja; službeni vektorski skup naselja nije otvoreno objavljen.`,
  },
  {
    key: "county_boundaries",
    set: "Granice županija",
    publisher: "DHMZ",
    license: (
      <>
        Otvorena dozvola, uz navođenje <Ac end="a">DHMZ</Ac>
      </>
    ),
    about: "Za kartu i za određivanje županije svakog naselja.",
  },
];

/* ------------------------------------------------------------ the sources table */

function SourcesTable({
  sources,
  overview,
  loading,
}: {
  sources: SourceFreshness[] | undefined;
  overview: WaitingOverview | undefined;
  loading: boolean;
}) {
  const byKey = new Map((sources ?? []).map((s) => [s.source_key, s]));
  // Sources the backend knows and this page does not describe still get a row, under their label.
  const extra: SourceMeta[] = (sources ?? [])
    .filter((s) => !SOURCES.some((m) => m.key === s.source_key))
    .map((s) => ({ key: s.source_key, set: s.label, publisher: "", license: "" }));
  const q = overview?.quality;

  const about = (m: SourceMeta, live: SourceFreshness | undefined): string | null => {
    if (m.key === "cezih_lists") {
      const counts = q
        ? ` za ${fmtInt(q.procedures_with_lists)}${NBSP}${plural(q.procedures_with_lists, "postupak", "postupka", "postupaka")} u ${fmtInt(q.institutions)}${NBSP}${plural(q.institutions, "ustanovi", "ustanove", "ustanova")}`
        : "";
      return `Prvi slobodni termini i dani čekanja${counts}, s kontaktima za naručivanje. Portal ne čuva povijest, pa se svaki dan sprema snimka za trend.`;
    }
    if (m.edition && live?.source_updated_at) {
      const month = monthYear(live.source_updated_at.slice(0, 7));
      return month ? `${m.edition} iz ${month}` : null;
    }
    return m.about ?? null;
  };

  // Narrower than the table (about.css), each source becomes an entry: its name and what it
  // holds, then „HZZO · licence” and „Svakih 12 sati · 10.734 zapisa · preuzeto …”. The cells stay
  // a table for screen readers, which read them with their column names; the run-in words are
  // aria-hidden copies.
  const sep = `${NBSP}· `;
  return (
    <div className="srcs">
      <table className="tbl srcs__t">
        <caption className="visually-hidden">
          Izvori podataka: skup, izdavač, licenca, osvježavanje i broj zapisa
        </caption>
        <thead>
          <tr>
            <th scope="col">Skup</th>
            <th scope="col">Izdavač</th>
            <th scope="col">Licenca</th>
            <th scope="col">Osvježavanje</th>
            <th scope="col" className="r">
              Zapisa
            </th>
          </tr>
        </thead>
        <tbody>
          {[...SOURCES, ...extra].map((m) => {
            const live = byKey.get(m.key);
            const text = about(m, live);
            const phrase = live ? refreshPhrase([live.interval_minutes]) : null;
            const count = live?.record_count ?? null;
            const records = count != null ? plural(count, "zapis", "zapisa", "zapisa") : "";
            return (
              <tr key={m.key}>
                <th scope="row">
                  <span className="tbl__name">{withAc(m.set)}</span>
                  {text ? <span className="tbl__sub srcs__about">{withAc(text)}</span> : null}
                </th>
                <td className="srcs__pub">{m.publisher ? withAc(m.publisher) : "—"}</td>
                <td className="srcs__lic">
                  {m.publisher ? (
                    <span className="srcs__in" aria-hidden="true">
                      <b>{withAc(m.publisher)}</b>
                      {sep}
                    </span>
                  ) : null}
                  {m.license || "—"}
                </td>
                <td className="srcs__when">
                  {loading ? (
                    <span className="skeleton srcs__skel" />
                  ) : live ? (
                    <>
                      {phrase ? capitalize(phrase) : "—"}
                      {count != null ? (
                        <span className="srcs__in" aria-hidden="true">
                          {`${sep}${fmtInt(count)}${NBSP}${records}`}
                        </span>
                      ) : null}
                      <span className="tbl__sub srcs__got">
                        preuzeto {stampHr(live.last_success_at) || "još nije"}
                        {live.state === "stale" ? <b className="srcs__bad"> · zastarjelo</b> : null}
                        {live.state === "error" ? (
                          <b className="srcs__bad"> · zadnje preuzimanje nije uspjelo</b>
                        ) : null}
                      </span>
                    </>
                  ) : (
                    <span className="srcs__none">{sources ? "nije učitano" : "—"}</span>
                  )}
                </td>
                <td className="r srcs__n">
                  {loading ? (
                    <span className="skeleton srcs__skel srcs__skel--n" />
                  ) : count != null ? (
                    fmtInt(count)
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const AC_TEXT = /(?<![\p{L}\d])(HZZO|CEZIH|HALMED|DZS|DHMZ)(?:-(\p{Ll}+))?(?![\p{L}\d])/gu;

/** Hand-written copy with acronyms as reduced capitals. */
function withAc(raw: string): ReactNode {
  // Croatian typesetting first (a one-letter word keeps to the next one), then the acronyms.
  const text = nbspHr(raw);
  const out: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(AC_TEXT)) {
    if (match.index > at) out.push(text.slice(at, match.index));
    out.push(
      <Ac key={match.index} end={match[2]}>
        {match[1] ?? ""}
      </Ac>,
    );
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/* ------------------------------------------------------------ the page */

/** How one answer is made, in four steps (a simple drawing instead of a long text). */
const STEPS: { title: string; text: ReactNode }[] = [
  { title: "Pitate", text: "Glasom ili tipkanjem, na hrvatskom, svojim riječima." },
  {
    title: "Asistent razumije",
    text: "Prepozna pregled ili pretragu, mjesto i lijek; kad nije jasno, pita na što mislite.",
  },
  {
    title: "Alati traže",
    text: (
      <>
        U&nbsp;lokalnoj kopiji podataka <Ac end="a">HZZO</Ac>, <Ac end="a">CEZIH</Ac>, <Ac end="a">HALMED</Ac>{" "}
        i&nbsp;<Ac end="a">DZS</Ac>, bez interneta.
      </>
    ),
  },
  {
    title: "Odgovor s izvorom",
    text: "Brojke, datume i nazive slaže sustav; jezični model ih samo prepričava.",
  },
];

const SECTIONS = [
  { href: "#kako", label: "Kako radi" },
  { href: "#izvori", label: "Izvori" },
  { href: "#privatnost", label: "Privatnost" },
  { href: "#pristupacnost", label: "Pristupačnost" },
  { href: "#profili", label: "Dva profila" },
  { href: "#ogranicenja", label: "Ograničenja" },
];

const PROFILES: { row: string; premium: string; open: string }[] = [
  { row: "Glasovni sloj", premium: "ElevenLabs Agents", open: "Pipecat" },
  {
    row: "Prepoznavanje govora i jezični model",
    premium: "u oblaku, u sklopu ElevenLabs Agents",
    open: "Whisper i gpt-oss preko Groqa, modeli otvorenih težina",
  },
  {
    row: "Sinteza govora",
    premium: "prirodan hrvatski glas visoke kvalitete, u oblaku",
    open: "hrvatski glas na procesoru vlastitog poslužitelja",
  },
  { row: "Gdje radi", premium: "javna poveznica (ova stranica)", open: "na vlastitom poslužitelju, bez javne poveznice" },
  { row: "Pokretanje", premium: "u pregledniku, bez instalacije", open: "jednom naredbom (Docker), otvoreni kod" },
];

export function AboutPage() {
  useTitle("O projektu");
  const sources = useQuery({ queryKey: ["sources"], queryFn: api.sources, staleTime: 5 * 60_000 });
  const overview = useQuery({ queryKey: ["waiting-overview"], queryFn: api.waitingOverview });

  return (
    <div className="ab">
      <header className="phead phead--big">
        <div className="phead__text">
          <h1>O projektu</h1>
          <p className="phead__lede">
            Uputko pokazuje gdje se na isti pregled čeka kraće, gdje je najbliža ambulanta i&nbsp;što piše o&nbsp;lijeku.
            Podatke rasute po portalima povezuje na jednom mjestu: u&nbsp;pretragama i&nbsp;u&nbsp;razgovoru s&nbsp;AI
            asistentom, na hrvatskom i&nbsp;uvijek s&nbsp;izvorom.
          </p>
          <nav className="pnav" aria-label="Na ovoj stranici">
            <ul>
              {SECTIONS.map((s) => (
                <li key={s.href}>
                  <a href={s.href}>{s.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <Section id="kako" title="Kako radi">
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="steps__i">
              <span className="steps__n" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
        <p className="ab-note">
          Lokalnu kopiju osvježavaju zakazani poslovi; koliko često, piše u&nbsp;tablici izvora. Tijekom razgovora ništa
          se ne dohvaća s&nbsp;interneta.
        </p>
      </Section>

      <Section id="izvori" title="Izvori podataka">
        <div aria-busy={sources.isPending}>
          {sources.isPending ? <p className="visually-hidden">Učitavanje…</p> : null}
          {sources.isError ? (
            <div className="runin runin--alert ab-err" role="alert">
              <p>
                <b>Stanje izvora trenutno nije dostupno.</b> Popis izvora i&nbsp;licence vrijede; broj zapisa i&nbsp;vrijeme
                osvježavanja pojavit će se kad se veza vrati.
              </p>
              <p className="runin__acts">
                <button type="button" className="btn btn--sm" onClick={() => void sources.refetch()}>
                  Pokušaj ponovno
                </button>
              </p>
            </div>
          ) : null}
          <SourcesTable sources={sources.data} overview={overview.data} loading={sources.isPending} />
        </div>
        <p className="ab-note">
          Skupovi <Ac end="a">HALMED</Ac>, <Ac end="a">DZS</Ac> i&nbsp;<Ac end="a">HZZO</Ac> pronalaze se preko{" "}
          <abbr className="ac">CKAN</abbr> <abbr className="ac">API</abbr>-ja portala{" "}
          <ExtLink href="https://data.gov.hr">data.gov.hr</ExtLink>; gdje portal upućuje na zastarjele datoteke, posao
          čita izvornu stranicu izdavača. Licenca je ona koju navodi izdavač skupa.
        </p>
      </Section>

      {/* The pledge says exactly what the backend keeps: tool_calls (tool, topic, settlement,
          municipality, county, profile, time, and the answer's status and latency;
          services/tool_log.py) and the answer cards, purged after 24 hours (services/cards.py).
          Change them together. */}
      <Section id="privatnost" title="Privatnost">
        <ul className="ab-list">
          <li>
            <b>Glas se ne snima, a&nbsp;zapis razgovora briše se nakon razgovora.</b>
          </li>
          <li>
            Glas i&nbsp;tekst razgovora obrađuju ElevenLabs i&nbsp;jezični model, s&nbsp;prijenosom u&nbsp;SAD; u&nbsp;otvorenom
            profilu Groq ili vlastito računalo.
          </li>
          <li>
            Bilježi se samo statistika bez podataka o&nbsp;osobi: alat, tema, naselje, općina i&nbsp;županija, profil, vrijeme
            te ishod i&nbsp;trajanje odgovora.
          </li>
          <li>
            Lokacija se koristi samo uz vaše dopuštenje i&nbsp;odmah svodi na naselje, bez spremanja točnih koordinata.
          </li>
          <li>Odgovori koje vidite na ekranu čuvaju se 24 sata, a&nbsp;zatim se brišu.</li>
          <li>Slova i&nbsp;ikone učitavaju se s&nbsp;poslužitelja projekta, bez praćenja.</li>
        </ul>
        <p>
          <Link to="/privatnost">Cijela obavijest o&nbsp;privatnosti</Link>
        </p>
      </Section>

      <Section id="pristupacnost" title="Pristupačnost">
        <ul className="ab-list">
          <li>
            <b>Bez gledanja u&nbsp;ekran:</b> na stranici AI asistent prvi je gumb mikrofon (jedan Tab nakon „Preskoči
            na sadržaj”). Nakon dopuštenja mikrofona razgovor ide glasom: asistent kaže najbliži i&nbsp;raniji termin, na
            zahtjev pročita broj telefona, a&nbsp;razgovor se završava glasom („to je sve”) ili gumbom na koji fokus
            prelazi sam.
          </li>
          <li>
            <b>Čitač zaslona:</b> naslovi, oznake polja i&nbsp;orijentiri na svim stranicama; promjene stanja (spajanje,
            početak i&nbsp;kraj razgovora, rezultat pretrage) čitaju se same, a&nbsp;u&nbsp;glasovnom razgovoru čitač ne
            ponavlja izgovoreno.
          </li>
          <li>Sve radi tipkovnicom, a&nbsp;fokus je jasno označen.</li>
          <li>
            Gumb „Prikaz” u&nbsp;gornjoj traci daje veća slova, visoki kontrast, tamnu temu i&nbsp;smanjene animacije;
            stranice se ne pomiču vodoravno ni na zaslonu širokom 320&nbsp;px.
          </li>
          <li>Boje na karti i&nbsp;u&nbsp;tablicama uvijek dolaze s&nbsp;brojem ili natpisom, nikad same.</li>
          <li>
            <b>Provjereno:</b> axe-core (<abbr className="ac">WCAG</abbr> 2.2 A i&nbsp;AA) bez nalaza na svim stranicama,
            u&nbsp;svijetloj i&nbsp;tamnoj temi i&nbsp;u&nbsp;visokom kontrastu (31.&nbsp;10.&nbsp;2026.). Test
            sa slabovidnim korisnicima i&nbsp;čitačima NVDA, VoiceOver i&nbsp;TalkBack tek slijedi.
          </li>
          <li>
            <b>Ograničenje:</b> u&nbsp;pregledniku treba jedan pritisak da razgovor počne. Korištenje isključivo glasom,
            bez ekrana, omogućio bi telefonski kanal, predviđen za sljedeću fazu.
          </li>
        </ul>
      </Section>

      <Section id="profili" title="Dva profila, isti podaci">
        <p className="ab-p">
          Oba profila koriste isti poslužitelj, iste alate i&nbsp;iste podatke. Razlikuje se samo glasovni sloj, pa se
          može zamijeniti drugim, na primjer državnim sustavom za govor.
        </p>
        <div className="profs">
          <table className="tbl profs__t">
            <caption className="visually-hidden">Usporedba profila premium i open</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Dio sustava</span>
                </th>
                <th scope="col">
                  <span className="profs__name">Premium</span>
                  <span className="profs__sub">ova aplikacija</span>
                </th>
                <th scope="col">
                  <span className="profs__name">Open</span>
                  <span className="profs__sub">otvoreni kod</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {PROFILES.map((p) => (
                <tr key={p.row}>
                  <th scope="row">{p.row}</th>
                  <td>
                    <span className="profs__k" aria-hidden="true">
                      Premium:{" "}
                    </span>
                    {nbspHr(capitalize(p.premium))}
                  </td>
                  <td>
                    <span className="profs__k" aria-hidden="true">
                      Open:{" "}
                    </span>
                    {nbspHr(capitalize(p.open))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Isto u oba</th>
                <td colSpan={2}>Poslužitelj, alati, lokalna baza i{NBSP}izvori podataka</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <Section id="ogranicenja" title="Ograničenja">
        <ul className="ab-list">
          <li>
            Liste čekanja objavljuju same ustanove; termin se potvrđuje pri naručivanju, a&nbsp;za pregled preko{" "}
            <Ac end="a">HZZO</Ac> treba uputnica.
          </li>
          <li>
            Skupovi <Ac end="a">HZZO</Ac> na portalu upućuju na popise iz 2018., pa se aktualni čitaju s{NBSP}
            <ExtLink href="https://hzzo.hr">hzzo.hr</ExtLink>.
          </li>
          <li>
            Lokacije ustanova poznate su do razine naselja; privatne ordinacije s&nbsp;lista nemaju lokaciju jer se ime
            liječnika ne sprema.
          </li>
          <li>
            Uputko ne daje medicinske ni pravne savjete, a&nbsp;u&nbsp;hitnom slučaju odmah upućuje na{NBSP}
            <a className="ab-sos" href="tel:112">
              112
            </a>
            .
          </li>
          <li>Popis dežurnih ljekarni na portalu nije ažuriran od 2023., pa ga Uputko ne koristi.</li>
        </ul>
      </Section>

      <Section id="impresum" title="Impresum">
        <dl className="colo">
          <div>
            <dt>Projekt</dt>
            <dd>
              Datathon Portala otvorenih podataka 2026 · <span className="nw">FERIT Osijek</span>
            </dd>
          </div>
          <div>
            <dt>Kod</dt>
            <dd>
              Otvoren, pod licencom EUPL-1.2: <ExtLink href="https://github.com/egi03/uputko">github.com/egi03/uputko</ExtLink>
            </dd>
          </div>
          <div>
            <dt>Pismo</dt>
            <dd>Schibsted Grotesk (SIL OFL), s&nbsp;poslužitelja projekta</dd>
          </div>
          <div>
            <dt>Ikone</dt>
            <dd>Lucide (ISC)</dd>
          </div>
          <div>
            <dt>Napomena</dt>
            <dd>
              Prototip; nije služba države ni <Ac end="a">HZZO</Ac>. Ne daje medicinske savjete ni dijagnoze.
            </dd>
          </div>
        </dl>
      </Section>
    </div>
  );
}
