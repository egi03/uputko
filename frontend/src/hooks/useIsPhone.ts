import { useSyncExternalStore } from "react";

/** The phone layout's width, the same as the stylesheets' media query. */
const PHONE = "(max-width: 760px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

/** Whether the page is at phone width, for what CSS cannot decide: how many rows come first. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE).matches);
}
