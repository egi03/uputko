import { ClipboardList, Mail } from "lucide-react";
import { useId, useState } from "react";

import { stampYearHr } from "../format";
import type { WaitOption } from "../types";
import { forProcedure, instKey } from "../waiting";
import { TelLink } from "./TelLink";
import { Ac, Typeset } from "./Typeset";

type HeadingLevel = 2 | 3 | 4;

interface GuideProps {
  /** The institutions the answer suggests, with the contacts from their lists (named in order). */
  options?: WaitOption[];
  /** The procedure as the page names it ("MR koljena"): what to say on the telephone. */
  procedure?: string;
  /** When the lists were fetched: what "prvi slobodni termin" was as of. */
  updatedAt?: string | null;
  headingLevel?: HeadingLevel;
}

/**
 * „Kako se naručiti?” as a button that opens the guide right under it (a disclosure: the focus
 * stays on the button, the guide follows it in reading order). The guide is printed with the
 * answer whether it is open or not (styles/print.css).
 */
export function BookingCta({
  className,
  label = "Kako se naručiti?",
  ...guide
}: GuideProps & { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div className={className ? `booking-cta ${className}` : "booking-cta"}>
      <button
        type="button"
        className="btn booking-cta__btn"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((o) => !o)}
      >
        <ClipboardList aria-hidden="true" />
        {label}
      </button>
      <div id={panel} className="booking-cta__panel" hidden={!open}>
        <BookingGuide {...guide} />
      </div>
    </div>
  );
}

/**
 * How to book an appointment found on a waiting list, in four short steps: the referral, whom to
 * contact (with the contacts of the suggested institutions), what to bring, what the slot means;
 * then three one-line notes. Written from HZZO's rules as published.
 */
function BookingGuide({ options = [], procedure, updatedAt, headingLevel = 3 }: GuideProps) {
  const Heading = `h${headingLevel}` as const;
  const Sub = `h${Math.min(headingLevel + 1, 6)}` as "h3" | "h4" | "h5";
  const contacts = options.filter((o) => o.phone?.trim() || o.email);
  const asOf = updatedAt ? stampYearHr(updatedAt) : "";
  const headingId = useId();
  return (
    <section className="booking" aria-labelledby={headingId}>
      <Heading className="booking__h" id={headingId}>
        Kako se naručiti
      </Heading>
      <ol className="booking__steps">
        <li>
          <Sub className="booking__k">Uputnica</Sub>
          <p>
            E-uputnica obiteljskog liječnika (za dijete pedijatra, za ginekološki pregled ginekologa). Vrijedi
            u&nbsp;ustanovama s&nbsp;ugovorom s&nbsp;<Ac end="om">HZZO</Ac>; ako glasi na drugu ustanovu, liječnik je
            može izdati za odabranu.
          </p>
        </li>
        <li>
          <Sub className="booking__k">Kome se javiti</Sub>
          <p>
            Ustanovi, telefonom ili e-poštom{procedure ? `: recite da imate e-uputnicu ${forProcedure(procedure)}` : ""}.
            Naručiti vas može i&nbsp;liječnik.
          </p>
          {contacts.length ? (
            <ul className="booking__contacts" aria-label="Kontakti s lista čekanja">
              {contacts.map((o) => (
                <li key={`${instKey(o)}-${o.role}`}>
                  <span className="booking__who">
                    <Typeset text={o.spoken_name} />
                  </span>
                  <span className="booking__how">
                    <TelLink raw={o.phone} name={o.spoken_name} icon />
                    {o.email ? (
                      <a className="booking__mail" href={`mailto:${o.email}`}>
                        <Mail aria-hidden="true" />
                        <span>{o.email}</span>
                      </a>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
        <li>
          <Sub className="booking__k">Što ponijeti</Sub>
          <p>Zdravstvenu iskaznicu, iskaznicu dopunskog osiguranja i&nbsp;ranije nalaze.</p>
        </li>
        <li>
          <Sub className="booking__k">Što znači termin</Sub>
          <p>
            Prvi slobodni termin s&nbsp;liste{asOf ? ` (stanje ${asOf})` : ""}. Nije rezervacija: ustanova ga potvrđuje
            kad se naručite.
          </p>
        </li>
      </ol>
      <ul className="booking__notes">
        <li>Prijevoz do ustanove koju ste sami odabrali <Ac>HZZO</Ac> ne plaća.</li>
        <li>Ne možete doći? Otkažite termin.</li>
        <li>
          Hitno: <a href="tel:194">194</a> ili <a href="tel:112">112</a>.
        </li>
      </ul>
    </section>
  );
}
