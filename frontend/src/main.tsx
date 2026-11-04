// Type is served from our own server: one grotesque, Schibsted Grotesk.
import "@fontsource-variable/schibsted-grotesk/wght.css";
import "@fontsource-variable/schibsted-grotesk/wght-italic.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/layout.css";
import "./styles/pages.css";
import "./styles/home.css";
import "./styles/booking.css";
import "./styles/cards.css";
import "./styles/assistant.css";
import "./styles/termini.css";
import "./styles/lijekovi.css";
import "./styles/charts.css";
import "./styles/map.css";
import "./styles/dashboard.css";
import "./styles/about.css";
import "./styles/print.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { apply } from "./prefs";
import { PrefsProvider } from "./PrefsProvider";

// Apply saved display preferences before the first paint (no flash of the default layout).
apply();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
});

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

createRoot(root).render(
  <StrictMode>
    <PrefsProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </PrefsProvider>
  </StrictMode>,
);
