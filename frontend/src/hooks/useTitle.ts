import { useEffect } from "react";

/** Page title per route, so screen readers and browser tabs say where you are. */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Uputko`;
  }, [title]);
}
