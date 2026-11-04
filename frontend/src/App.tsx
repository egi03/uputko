import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from "react-router-dom";

import { Apology, PageFailed } from "./components/ErrorBoundary";
import { Layout } from "./components/Layout";
import { useTitle } from "./hooks/useTitle";
import { HomePage } from "./pages/Home";

// The front page comes with the app; the others load on demand (the voice SDK and the charts are
// large).
const AssistantPage = lazy(() => import("./pages/Assistant").then((m) => ({ default: m.AssistantPage })));
const TerminiPage = lazy(() => import("./pages/Termini").then((m) => ({ default: m.TerminiPage })));
const LijekoviPage = lazy(() => import("./pages/Lijekovi").then((m) => ({ default: m.LijekoviPage })));
const DashboardPage = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const AboutPage = lazy(() => import("./pages/About").then((m) => ({ default: m.AboutPage })));
const PrivacyPage = lazy(() => import("./pages/Privacy").then((m) => ({ default: m.PrivacyPage })));

/** How long a page may take before the loader shows: a quick page never flashes it. */
const LOADER_DELAY_MS = 240;

/** The tab says the page is on its way, not the name of the page that was left. */
function LoadingTitle() {
  useTitle("Učitavanje…");
  return null;
}

/**
 * While a page's code arrives: one quiet line with a small spinner. The page's room is held at
 * once, so the footer stays below the fold instead of jumping down when the page arrives. The
 * loader itself waits in React, not in a CSS delay, so it also waits with reduced motion (which
 * removes every animation, delays included).
 */
function Loading() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), LOADER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="loading" role="status">
      {shown ? (
        <p className="loading__in">
          <LoadingTitle />
          <span className="spinner" aria-hidden="true" />
          Učitavanje…
        </p>
      ) : null}
    </div>
  );
}

/** 404. */
function NotFound() {
  useTitle("Stranica ne postoji");
  return (
    <Apology title="Ovdje nema ničega">
      Ova stranica ne postoji ili je poveznica zastarjela.
    </Apology>
  );
}

function page(element: ReactNode) {
  return <Suspense fallback={<Loading />}>{element}</Suspense>;
}

/**
 * A data router, so the assistant can ask before any navigation, back and forward included, ends
 * its conversation (useBlocker). The pages have their own error boundary inside the layout; the
 * layout's own failure gets the same way out.
 */
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Layout />} errorElement={<PageFailed />}>
      <Route index element={<HomePage />} />
      <Route path="asistent" element={page(<AssistantPage />)} />
      <Route path="termini" element={page(<TerminiPage />)} />
      <Route path="lijekovi" element={page(<LijekoviPage />)} />
      <Route path="dashboard" element={page(<DashboardPage />)} />
      <Route path="o-projektu" element={page(<AboutPage />)} />
      <Route path="privatnost" element={page(<PrivacyPage />)} />
      <Route path="*" element={<NotFound />} />
    </Route>,
  ),
);

export function App() {
  return <RouterProvider router={router} />;
}
