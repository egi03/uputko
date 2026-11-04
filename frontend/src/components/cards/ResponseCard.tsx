import type { AnswerProps } from "./answers";
import { DrugAnswer } from "./DrugEntry";
import { FacilitiesAnswer } from "./FacilitiesAnswer";
import { StatusAnswer } from "./StatusAnswer";
import { WaitingAnswer } from "./WaitingAnswer";

/**
 * A tool's answer in the conversation as a clean card under the assistant's reply
 *: waiting lists with tickets, a medicine, practices and hospitals as a list,
 * and a plain card for everything else. Every card ends with its source and date. Every link
 * inside opens a new tab, so a live voice session never ends because someone looked something up.
 *
 * Optional: `n` (id „odgovor-n”, focusable without a marker), `headingLevel` (2 by default, right
 * under the page's h1), `showSummary`, `said` (the assistant's words above, not repeated) and
 * `onPick` (candidates of an unclear question become buttons that ask again).
 */
export function ResponseCard(props: AnswerProps) {
  const { card } = props;
  if (card.status === "ok") {
    if (card.tool === "find_waiting_times") return <WaitingAnswer {...props} />;
    if (card.tool === "get_drug_info") return <DrugAnswer {...props} />;
    if (card.tool === "find_health_facilities") return <FacilitiesAnswer {...props} />;
  }
  // A known procedure with no free slot keeps its headline, median and the contracted providers.
  if (card.status === "no_data" && card.tool === "find_waiting_times" && card.data.procedure) {
    return <WaitingAnswer {...props} />;
  }
  return <StatusAnswer {...props} />;
}
