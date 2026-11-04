import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { useTitle } from "../hooks/useTitle";

/**
 * A page that is not there or went wrong: one headline, one sentence and one
 * button (back to the front page, unless the page brings its own action).
 */
export function Apology({
  title,
  children,
  action,
  role,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  role?: "alert";
}) {
  return (
    <section className="apology" aria-labelledby="apology-title" role={role}>
      <h1 id="apology-title">{title}</h1>
      <p className="apology__text">{children}</p>
      <p className="apology__acts">
        {action ?? (
          <Link to="/" className="btn btn--teal">
            Natrag na početnu
          </Link>
        )}
      </p>
    </section>
  );
}

interface State {
  failed: boolean;
}

const FAILED = "Stranica se nije uspjela prikazati";

/** The failed page's own tab title: the page itself never ran, so its useTitle did not either. */
function FailedTitle() {
  useTitle(FAILED);
  return null;
}

/** A way out instead of an empty screen: reload. */
export function PageFailed() {
  return (
    <>
      <FailedTitle />
      <Apology
        title="Nešto je pošlo po zlu"
        role="alert"
        action={
          <button type="button" className="btn btn--teal" onClick={() => window.location.reload()}>
            Učitaj ponovno
          </button>
        }
      >
        Stranica se nije uspjela prikazati. Pokušajte je ponovno učitati.
      </Apology>
    </>
  );
}

/** A page that fails to render offers a way out instead of an empty screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page failed to render", error, info.componentStack);
  }

  render() {
    return this.state.failed ? <PageFailed /> : this.props.children;
  }
}
