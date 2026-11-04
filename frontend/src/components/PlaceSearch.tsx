import { api } from "../api";
import type { PlaceHit } from "../types";
import { Combobox, type ComboVariant } from "./Combobox";

/** Settlement search over the 6757 settlements of the gazetteer. */
export function PlaceSearch({
  label,
  placeholder = "Upišite naziv mjesta",
  onPick,
  onSubmitText,
  initialText,
  hint,
  variant,
}: {
  label: string;
  placeholder?: string;
  onPick: (hit: PlaceHit) => void;
  /** Enter without a highlighted option: the name as typed (the answer resolves it or asks). */
  onSubmitText?: (text: string) => void;
  initialText?: string;
  hint?: string;
  variant?: ComboVariant;
}) {
  return (
    <Combobox<PlaceHit>
      label={label}
      placeholder={placeholder}
      queryKey="places"
      search={api.places}
      optionKey={(o) => `${o.name}-${o.municipality}-${o.county}`}
      optionText={(o) => o.name}
      onPick={onPick}
      onSubmitText={onSubmitText}
      initialText={initialText}
      listLabel="Pronađena mjesta"
      countText={(n) => `Pronađeno: ${n}. Odaberite strelicama.`}
      hint={hint}
      variant={variant}
      renderOption={(o) => (
        <span className="combo__text">
          <strong>{o.name}</strong>
          <span className="combo__meta">
            {o.municipality} · {o.county}
          </span>
        </span>
      )}
    />
  );
}
