/** Small parts of /termini: a failed fetch, and the answer's shape while it loads. */
import type { ReactNode } from "react";

/* ------------------------------------------------------------------ small parts */

/** A failed fetch: what does not work and a way to try again. */
export function LoadError({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return (
    <div className="runin runin--alert tr-error" role="alert">
      <p>
        <b>{children}</b> Pokušajte ponovno za minutu.
      </p>
      <p className="runin__acts">
        <button type="button" className="btn btn--sm" onClick={onRetry}>
          Pokušaj ponovno
        </button>
      </p>
    </div>
  );
}

/** The answer's shape in still blocks while it loads: the headline, its source, three cards. */
export function ResultsSkeleton() {
  return (
    <div className="tr-res tr-res--loading" aria-busy="true">
      <p className="visually-hidden">Učitavanje…</p>
      <span className="skeleton tr-sk-h" />
      <span className="skeleton tr-sk-meta" />
      <span className="tr-sk-picks">
        <span className="skeleton" />
        <span className="skeleton" />
        <span className="skeleton" />
      </span>
    </div>
  );
}
