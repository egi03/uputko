import { api } from "../api";
import { days, plural } from "../format";
import type { ProcedureHit } from "../types";
import { procedureLabel } from "../waiting";
import { Combobox, type ComboVariant } from "./Combobox";
import { ProcedureName } from "./waiting/ProcedureName";

/** Search over the procedures with a waiting list (the same matching as the assistant). */
export function ProcedureSearch({
  onPick,
  onSubmitText,
  initialText,
  variant,
  placeholder = "npr. MR koljena, kardiolog, kolonoskopija",
}: {
  onPick: (hit: ProcedureHit) => void;
  onSubmitText?: (text: string) => void;
  initialText?: string;
  variant?: ComboVariant;
  placeholder?: string;
}) {
  return (
    <Combobox<ProcedureHit>
      label="Pregled ili pretraga"
      placeholder={placeholder}
      queryKey="procedures"
      search={api.procedures}
      optionKey={(o) => String(o.id)}
      optionText={(o) => procedureLabel(o.name)}
      onPick={onPick}
      onSubmitText={onSubmitText}
      initialText={initialText}
      listLabel="Pronađeni postupci"
      countText={(n) => `Pronađeno: ${n}. Odaberite strelicama.`}
      variant={variant}
      renderOption={(o) => (
        <span className="combo__text">
          <strong>
            <ProcedureName name={o.name} />
          </strong>
          <span className="combo__meta">
            {o.institutions
              ? `${o.institutions} ${plural(o.institutions, "ustanova", "ustanove", "ustanova")} s listom`
              : "nema objavljenih lista"}
            {o.median_days !== null ? ` · medijan ${days(o.median_days)}` : ""}
          </span>
        </span>
      )}
    />
  );
}
