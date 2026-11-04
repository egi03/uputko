import { NBSP, capitalize, dateHr, fmt, plural } from "../../format";
import type { Provider, WaitingData, WaitingExtra, WaitOption } from "../../types";
import { insteadText, instKey, nearestAndSooner, procedureLabel, termsLink, waitTone } from "../../waiting";
import { BookingCta } from "../BookingGuide";
import { Coupons } from "../Coupon";
import { ExtLink } from "../ExtLink";
import { TelLink } from "../TelLink";
import { Typeset } from "../Typeset";
import { ProcedureName } from "../waiting/ProcedureName";
import { AnswerFigure } from "./AnswerFigure";
import { type AnswerProps, SEP, answerSource, kmWords, rowOptions, waitPhrase, waitWord } from "./answers";

/**
 * A waiting-list answer: the procedure as the title, the place and the
 * Croatian median under it, the point of the answer („Za 32 dana umjesto 68”), the tickets (big
 * days, phone), the other options nearby and the institutions with a contract but no list as
 * plain rows, „Kako se naručiti?”, the way to the full table, the source. Also used when the
 * procedure is known but no list has a free slot (no_data).
 */
export function WaitingAnswer({ card, n, headingLevel = 2, showSummary = false }: AnswerProps) {
  const d = card.data as Partial<WaitingData>;
  const extra = card.extra as Partial<WaitingExtra>;
  const options = d.options ?? [];
  const rows = rowOptions(options);
  const providers = d.other_providers ?? [];
  const median = d.median_days ?? null;
  const lists = d.institutions_on_list ?? 0;
  const pair = nearestAndSooner(options);
  const sub = [
    d.origin ? `od${NBSP}mjesta ${d.origin}` : null,
    median !== null ? `medijan u${NBSP}Hrvatskoj ${fmt(median)}${NBSP}${plural(median, "dan", "dana", "dana")}` : null,
  ].filter(Boolean);
  return (
    <AnswerFigure
      n={n}
      headingLevel={headingLevel}
      className="ans--wait"
      title={d.procedure ? <ProcedureName name={d.procedure.name} /> : "Liste čekanja"}
      sub={sub.length ? sub.join(SEP) : null}
      source={answerSource(card)}
    >
      {showSummary ? (
        <p className="ans__text">
          <Typeset text={card.summary_hr} />
        </p>
      ) : null}
      {pair ? (
        <p className="ans__instead">
          <b>{insteadText(pair.sooner.wait_days, pair.nearest.wait_days)}</b>
          {pair.sooner.wait_days > 1 ? `${NBSP}${plural(pair.nearest.wait_days, "dan", "dana", "dana")}` : ""}
          {pair.sooner.distance_km !== null && pair.sooner.distance_km >= 2
            ? `, oko ${fmt(pair.sooner.distance_km)}${NBSP}km${d.origin ? ` od mjesta ${d.origin}` : ""}`
            : ""}
        </p>
      ) : null}
      {options.length ? (
        <Coupons
          options={options}
          entries={extra.entries ?? options}
          median={median}
          headingLevel={(headingLevel + 1) as 3 | 4 | 5}
        />
      ) : (
        <p className="ans__text">
          <b>Bez slobodnog termina.</b>{" "}
          {lists ? `${capitalize(noneWords(lists))}.` : "Na listama trenutno nema objavljenog slobodnog termina."}
        </p>
      )}
      {rows.length || providers.length ? (
        <ul className="ans__rows" aria-label="Također u blizini">
          {rows.map((o) => (
            <NearRow key={`${instKey(o)}-${o.role}`} option={o} median={median} />
          ))}
          {providers.map((p, i) => (
            <ProviderRow key={`${p.name}-${p.settlement}-${i}`} provider={p} />
          ))}
        </ul>
      ) : null}
      {options.length ? (
        <BookingCta
          className="ans__book"
          options={options.slice(0, 3)}
          procedure={d.procedure ? procedureLabel(d.procedure.name) : undefined}
          updatedAt={card.updated_at}
          headingLevel={(headingLevel + 1) as 3 | 4}
        />
      ) : null}
      <div className="ans__foot">
        {/* The count of the page it opens: every institution with a list, so it agrees with the table. */}
        <ExtLink href={termsLink(d, card.location)}>
          {lists ? `Sve ustanove (${lists}) i${NBSP}karta` : `Sve ustanove i${NBSP}karta`}
        </ExtLink>
        {/* How to book is in „Kako se naručiti?” above; without an appointment, the short note stays. */}
        {d.booking_hr && !options.length ? (
          <p className="ans__note">
            <Typeset text={d.booking_hr} />
          </p>
        ) : null}
      </div>
    </AnswerFigure>
  );
}

/** „nijedna od 4 ustanove s listom nema slobodan termin” („od 4 ustanove” held together). */
function noneWords(lists: number): string {
  return `nijedna od${NBSP}${lists}${NBSP}${plural(lists, "ustanove", "ustanove", "ustanova")} s${NBSP}listom nema slobodan termin`;
}

/**
 * Another option close by, as a row: the institution and where and when on the left, „112 dana”
 * on the right (coloured against the median, with the number beside it).
 */
function NearRow({ option: o, median }: { option: WaitOption; median: number | null }) {
  const word = waitWord(o.wait_days);
  const km = kmWords(o.distance_km, true);
  const meta = [o.settlement, km, dateHr(o.first_slot)].filter(Boolean).join(SEP);
  return (
    <li className="arow">
      <div className="arow__main">
        <p className="arow__name">
          <span className="visually-hidden">{waitPhrase(o.wait_days)}: </span>
          <Typeset text={o.spoken_name} />
        </p>
        <p className="arow__meta">
          {meta}
          {o.phone ? (
            <>
              {SEP}
              <TelLink raw={o.phone} name={o.spoken_name} />
            </>
          ) : null}
        </p>
      </div>
      <p className={`arow__val arow__val--${waitTone(o.wait_days, median)}`} aria-hidden="true">
        <b>{word ?? `${fmt(o.wait_days)}${NBSP}${plural(o.wait_days, "dan", "dana", "dana")}`}</b>
      </p>
    </li>
  );
}

/** An institution with a contract for this service but no published list: call to ask. */
function ProviderRow({ provider: p }: { provider: Provider }) {
  const km = p.distance_km !== null && p.distance_km >= 2 ? `oko ${fmt(p.distance_km)}${NBSP}km` : null;
  const meta = [[p.address, p.settlement].filter(Boolean).join(", "), km].filter(Boolean).join(SEP);
  return (
    <li className="arow">
      <div className="arow__main">
        <p className="arow__name">
          <Typeset text={p.name} />
        </p>
        <p className="arow__meta">
          <Typeset text={meta} />
          {p.phone ? (
            <>
              {SEP}
              <TelLink raw={p.phone} name={p.name} />
            </>
          ) : null}
        </p>
      </div>
      <p className="arow__val arow__val--quiet">bez objavljene liste</p>
    </li>
  );
}
