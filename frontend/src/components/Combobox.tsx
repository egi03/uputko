import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";

import { useDebounced } from "../hooks/useDebounced";

export type ComboVariant = "field" | "slot";

interface Props<T> {
  label: string;
  placeholder?: string;
  /** React Query key prefix and fetcher for the options of a query (2+ characters). */
  queryKey: string;
  search: (q: string) => Promise<T[]>;
  optionKey: (item: T) => string;
  optionText: (item: T) => string;
  renderOption: (item: T) => ReactNode;
  onPick: (item: T) => void;
  /** Called with the typed text when Enter is pressed without a highlighted option. */
  onSubmitText?: (text: string) => void;
  initialText?: string;
  listLabel: string;
  /** "5 mjesta pronađeno" for screen readers. */
  countText: (n: number) => string;
  hint?: ReactNode;
  /**
   * "field": a labelled write-in field. "slot": a blank inside a sentence ("Tražim termin za
   * [MR koljena] u blizini mjesta [Vinkovci]") whose label is read but not
   * shown, and which turns back into a labelled field on a phone.
   */
  variant?: ComboVariant;
}

/** Accessible combobox (ARIA 1.2 pattern) with options from an API search. */
export function Combobox<T>({
  label,
  placeholder,
  queryKey,
  search,
  optionKey,
  optionText,
  renderOption,
  onPick,
  onSubmitText,
  initialText = "",
  listLabel,
  countText,
  hint,
  variant = "field",
}: Props<T>) {
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const [text, setText] = useState(initialText);
  // Suggestions are looked up only for what the visitor writes (or asks for with ↓), not for a
  // text the page filled in: a /termini view would otherwise cost two searches whose lists nobody
  // opens, and on a phone „Promijeni” would open a sheet over the next field.
  const [edited, setEdited] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const q = useDebounced(text.trim(), 150);
  const hits = useQuery({
    queryKey: [queryKey, q],
    queryFn: () => search(q),
    enabled: edited && q.length >= 2,
    staleTime: 5 * 60_000,
  });
  const options = edited && q.length >= 2 ? (hits.data ?? []) : [];
  const expanded = open && options.length > 0;

  // A new initial text from the parent (a link, a quick pick) replaces what was typed.
  const [shownInitial, setShownInitial] = useState(initialText);
  if (initialText !== shownInitial) {
    setShownInitial(initialText);
    setText(initialText);
    setEdited(false);
  }

  // The suggestions under a blank late in a sentence would run off the right edge: move them
  // back inside the page.
  useLayoutEffect(() => {
    const el = list.current;
    if (!expanded || !el) return;
    el.style.translate = "";
    const limit = document.documentElement.clientWidth - 8;
    const right = el.getBoundingClientRect().right;
    if (right > limit) el.style.translate = `${Math.round(limit - right)}px 0`;
  }, [expanded, options.length]);

  function pick(item: T) {
    setText(optionText(item));
    setEdited(false);
    setOpen(false);
    setActive(-1);
    onPick(item);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setEdited(true);
      setOpen(true);
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      const item = expanded ? options[active] : undefined;
      if (item) {
        e.preventDefault();
        pick(item);
      } else if (onSubmitText && text.trim()) {
        e.preventDefault();
        setOpen(false);
        onSubmitText(text.trim());
      } else if (expanded && options[0]) {
        // Without a way to send the text, the first option shown; never one the list hides.
        e.preventDefault();
        pick(options[0]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div className={variant === "slot" ? "combo combo--slot" : "combo"}>
      <label htmlFor={id} className="combo__label">
        {label}
      </label>
      <div className="field">
        <input
          ref={input}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-describedby={hint ? hintId : undefined}
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          placeholder={placeholder}
          // Where field-sizing is not supported, the blank is as wide as its text.
          size={variant === "slot" ? Math.max(4, (text || placeholder || "").length + 1) : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setEdited(true);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
        {text ? (
          <button
            type="button"
            className="combo__clear"
            aria-label="Obriši upis"
            onClick={() => {
              setText("");
              setEdited(true);
              setActive(-1);
              input.current?.focus(); // the button disappears; focus stays in the field
            }}
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className="combo__hint small">
          {hint}
        </p>
      ) : null}
      <ul ref={list} id={listId} role="listbox" aria-label={listLabel} className="combo__list" hidden={!expanded}>
        {options.map((o, i) => (
          <li
            key={optionKey(o)}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className="combo__option"
            onMouseDown={(e) => {
              e.preventDefault();
              pick(o);
            }}
            onMouseEnter={() => setActive(i)}
          >
            {renderOption(o)}
          </li>
        ))}
      </ul>
      <p className="visually-hidden" aria-live="polite">
        {expanded ? countText(options.length) : ""}
      </p>
    </div>
  );
}
