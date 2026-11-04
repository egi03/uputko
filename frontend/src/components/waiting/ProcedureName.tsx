import { procedureParts } from "../../waiting";
import { Typeset } from "../Typeset";

/**
 * A procedure name as it reads best: the specialty, then the kind of visit after a comma
 * ("Kardiologija, prvi pregled"), acronyms as small capitals ("MR koljena"). The visit kind is
 * a .visit span, for pages that want to set it apart.
 */
export function ProcedureName({ name }: { name: string }) {
  const { title, visit } = procedureParts(name);
  return (
    <>
      <Typeset text={title} />
      {visit ? <span className="visit">, {visit}</span> : null}
    </>
  );
}
