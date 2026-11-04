import { ArrowRight } from "lucide-react";

import type { ToolResponse } from "../../types";
import { ExtLink } from "../ExtLink";
import { Typeset } from "../Typeset";
import { AnswerFigure } from "./AnswerFigure";
import { type AnswerProps, NO_DATA, answerSource, saidAlready, statusTitle } from "./answers";

type Candidate = ToolResponse["candidates"][number];

/** Where a candidate leads when it cannot be asked again: its page, in a new tab. */
function candidateHref(c: Candidate): string | null {
  if (c.kind === "procedure") return `/termini?pretraga=${encodeURIComponent(c.name)}`;
  if (c.kind === "drug") return `/lijekovi?lijek=${encodeURIComponent(c.name)}`;
  return null;
}

/** „Sveti Ivan Zelina (Zagrebačka)” for a place, the name for anything else. */
function candidateText(c: Candidate): string {
  return c.kind === "place" && c.county ? `${c.name} (${c.county})` : c.name;
}

/**
 * An answer without data of its own: an unclear question with its candidates as buttons, a name
 * that was not found, no data, or an error. The title is the place or what happened, the text is
 * the tool's own sentence (left out when the assistant has just said it, `said`), and the source
 * and date stay at the bottom.
 *
 * The backend keeps cards only for answers with data and for no_data; the other states are
 * here so that an answer never renders as nothing.
 */
export function StatusAnswer({ card, n, headingLevel = 2, onPick, showSummary = false, said }: AnswerProps) {
  const candidates = card.status === "ambiguous" ? card.candidates : [];
  const title = statusTitle(card);
  const text = showSummary || !saidAlready(said, card.summary_hr) ? card.summary_hr : null;
  const error = card.status === "error";
  return (
    <AnswerFigure
      n={n}
      headingLevel={headingLevel}
      title={title}
      className={error ? "ans--alert" : undefined}
      source={error ? null : answerSource(card)}
    >
      {card.status === "no_data" && title !== NO_DATA ? (
        <p className="ans__text">
          <b>Nema podataka.</b>
          {text ? (
            <>
              {" "}
              <Typeset text={text} />
            </>
          ) : null}
        </p>
      ) : error ? (
        // Not role=alert: the transcript already announces what arrives in it.
        <>
          <p className="ans__text">
            <Typeset text={card.summary_hr} /> Liste čekanja i&nbsp;lijekovi rade i&nbsp;bez razgovora.
          </p>
          <p className="ans__chips">
            <ExtLink className="achip" href="/termini">
              Liste čekanja
            </ExtLink>
            <ExtLink className="achip" href="/lijekovi">
              Lijekovi
            </ExtLink>
          </p>
        </>
      ) : text ? (
        <p className="ans__text">
          <Typeset text={text} />
        </p>
      ) : null}
      {candidates.length ? (
        <ul className="ans__chips" aria-label="Mogući odgovori">
          {candidates.map((c) => {
            const href = candidateHref(c);
            return (
              <li key={`${c.kind}-${c.name}-${c.county ?? ""}`}>
                {onPick ? (
                  <button type="button" className="achip" onClick={() => onPick(c.name)}>
                    <span>
                      <Typeset text={candidateText(c)} />
                    </span>
                    <ArrowRight aria-hidden="true" />
                  </button>
                ) : href ? (
                  <ExtLink className="achip" href={href}>
                    <Typeset text={candidateText(c)} />
                  </ExtLink>
                ) : (
                  <span className="achip achip--still">
                    <Typeset text={candidateText(c)} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </AnswerFigure>
  );
}
