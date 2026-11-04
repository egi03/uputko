import { useEffect, useRef, useState } from "react";

import { api, ApiError } from "../api";

interface LocatedPlace {
  name: string;
  municipality: string;
  county: string;
}

/**
 * Why no place was found: the browser has no location, the person did not allow it, the device
 * could not tell in time, or the backend found no settlement for it (outside Croatia).
 */
export type LocateFailure = "unsupported" | "denied" | "unavailable" | "not_found";

/**
 * The browser's location reduced to a settlement name: the coordinates go only to /api/locate,
 * which answers with the nearest settlement and keeps nothing. The latest callbacks are used
 * when the answer arrives (the page may have changed meanwhile), and none after unmount.
 *
 * A failure comes with a sentence for a page that has a place field („… Upišite mjesto.”) and
 * with its reason, so a page without one can say it in its own words.
 */
export function useLocate(
  onFound: (place: LocatedPlace) => void,
  onError: (message: string, reason: LocateFailure) => void,
) {
  const [locating, setLocating] = useState(false);
  const callbacks = useRef({ onFound, onError });
  const mounted = useRef(true);

  useEffect(() => {
    callbacks.current = { onFound, onError };
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Reports the settlement at a position, or why there is none. */
  async function settle(pos: GeolocationPosition) {
    try {
      const found = await api.locate(pos.coords.latitude, pos.coords.longitude);
      if (mounted.current) callbacks.current.onFound({ name: found.name, municipality: found.municipality, county: found.county });
    } catch (e) {
      if (mounted.current) {
        callbacks.current.onError(e instanceof ApiError ? e.message : "Mjesto nije pronađeno.", "not_found");
      }
    } finally {
      if (mounted.current) setLocating(false);
    }
  }

  function locate() {
    if (!("geolocation" in navigator)) {
      onError("Preglednik ne podržava lokaciju. Upišite mjesto.", "unsupported");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => void settle(pos),
      (failure) => {
        if (!mounted.current) return;
        setLocating(false);
        if (failure.code === failure.PERMISSION_DENIED) {
          callbacks.current.onError("Lokacija nije dopuštena. Upišite mjesto.", "denied");
        } else {
          callbacks.current.onError("Lokacija trenutno nije dostupna. Upišite mjesto.", "unavailable");
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  return { locate, locating };
}
