import { NBSP, capitalize, fmt, fmtInt, plural } from "../../format";
import type { Facility } from "../../types";
import { ExtLink } from "../ExtLink";
import { TelLink } from "../TelLink";
import { Typeset } from "../Typeset";
import { AnswerFigure } from "./AnswerFigure";
import { type AnswerProps, FACILITY_TITLE, SEP, allInPlace, answerSource } from "./answers";

/** The noun the figure counts in, by kind of facility. */
function nouns(type: string): [one: string, few: string, many: string] {
  if (type === "hospital") return ["bolnica", "bolnice", "bolnica"];
  if (type === "any") return ["ustanova", "ustanove", "ustanova"];
  return ["ordinacija", "ordinacije", "ordinacija"];
}

/** „Park Kralja Petra Krešimira Iv. 6”: the house number stays on the line of its street. */
function address(f: Facility): string {
  return f.address ? f.address.trim().replace(/ (?=\d+\s?[a-zA-Z]?$)/, NBSP) : "adresa nije navedena";
}

/** OpenStreetMap search for an address (no tracking). */
function mapHref(f: Facility): string {
  const query = [f.address, f.settlement, "Hrvatska"].filter(Boolean).join(", ");
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
}

/** A street address as the source gives it, or null when it gives none. */
function street(f: Facility): string | null {
  return f.address.trim() ? address(f) : null;
}

/**
 * Practices or hospitals as a clean list: the kind and the place as the title
 * („Opća medicina, Osijek”: a place name is not declined), how many there are in the place as the
 * big number, then one row per facility with its address and kind, the phone and the map. Rows
 * with an address come first among equally near ones.
 */
export function FacilitiesAnswer({ card, n, headingLevel = 2, showSummary = false }: AnswerProps) {
  const d = card.data;
  const items = [...((d.facilities as Facility[] | undefined) ?? [])].sort(
    (a, b) => a.distance_km - b.distance_km || Number(!street(a)) - Number(!street(b)),
  );
  const type = (d.facility_type as string | undefined) ?? "any";
  const inPlace = (d.in_same_settlement as number | undefined) ?? 0;
  const place = card.location?.name;
  const [one, few, many] = nouns(type);
  const kind = FACILITY_TITLE[type] ?? "Zdravstvene ustanove";
  const title = place ? (allInPlace(items) ? `${kind}, ${place}` : `${kind} najbliže mjestu ${place}`) : kind;
  const shown = inPlace > items.length ? `${plural(items.length, "Prikazana je", "Prikazane su", "Prikazano je")} ${items.length} najbliž${plural(items.length, "a", "e", "ih")}. ` : "";
  return (
    <AnswerFigure
      n={n}
      headingLevel={headingLevel}
      className="ans--dir"
      title={title}
      figure={inPlace ? { n: fmtInt(inPlace), text: `${plural(inPlace, one, few, many)} u${NBSP}mjestu` } : null}
      source={answerSource(card)}
    >
      {showSummary ? (
        <p className="ans__text">
          <Typeset text={card.summary_hr} />
        </p>
      ) : null}
      <ul className="ans__rows" aria-label={kind}>
        {items.map((f, i) => (
          <DirRow key={`${f.address}-${f.settlement}-${i}`} facility={f} withType={type === "any"} />
        ))}
      </ul>
      <div className="ans__foot">
        <p className="ans__note">{shown}Prije odlaska provjerite radno vrijeme.</p>
      </div>
    </AnswerFigure>
  );
}

/**
 * One facility. A hospital is known by its name, a practice by its street (the title already says
 * what kind of practice it is); where the source gives no address, its kind stands there instead
 * („Dom zdravlja”) and the line under it says the address is missing.
 */
function DirRow({ facility: f, withType }: { facility: Facility; withType: boolean }) {
  const hospital = f.type === "hospital";
  const at = street(f);
  const name = hospital ? f.name : (at ?? capitalize(f.kind_hr || f.type_hr));
  const what = hospital ? [] : [withType ? f.type_hr : null, at ? f.kind_hr : null];
  const where = hospital || !at ? `${address(f)}, ${f.settlement}` : f.settlement;
  const meta = [[...what, where].filter(Boolean).join(", "), f.distance_km >= 0.5 ? `oko ${fmt(f.distance_km)}${NBSP}km` : null]
    .filter(Boolean)
    .join(SEP);
  return (
    <li className="arow arow--acts">
      <div className="arow__main">
        <p className="arow__name">
          <Typeset text={name} />
        </p>
        <p className="arow__meta">
          <Typeset text={meta} />
        </p>
      </div>
      {f.phone?.trim() || at ? (
        <p className="arow__acts">
          <TelLink raw={f.phone} name={hospital ? f.name : [f.type_hr, at].filter(Boolean).join(", ")} icon className="apill" />
          {/* Without an address a map would only show the town: no map is better than a wrong pin. */}
          {at ? (
            <ExtLink className="arow__map" href={mapHref(f)}>
              Karta<span className="visually-hidden">: {f.address}, OpenStreetMap</span>
            </ExtLink>
          ) : null}
        </p>
      ) : null}
    </li>
  );
}
