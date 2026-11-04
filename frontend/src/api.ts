import type {
  Access,
  Card,
  CountiesGeoJson,
  DrugAnswer,
  DrugHit,
  DrugOverview,
  PlaceHit,
  ProcedureHit,
  SessionToken,
  SourceFreshness,
  Stats,
  WaitingAnswer,
  WaitingCounties,
  WaitingExamples,
  WaitingOverview,
  WaitingTrend,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  const resp = await fetch(url);
  if (!resp.ok) {
    let detail = "Usluga trenutno nije dostupna.";
    try {
      const body = (await resp.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // keep the generic message
    }
    throw new ApiError(resp.status, detail);
  }
  return (await resp.json()) as T;
}

export const api = {
  locate: (lat: number, lon: number) =>
    get<{ name: string; municipality: string; county: string }>("/api/locate", {
      lat: lat.toFixed(3),
      lon: lon.toFixed(3),
    }),
  sessionToken: (transport: "webrtc" | "websocket") =>
    get<SessionToken>("/api/session-token", { transport }),
  card: (id: string) => get<Card>(`/api/cards/${id}`),
  access: () => get<Access>("/api/dashboard/access"),
  places: (q: string) => get<PlaceHit[]>("/api/places", { q }),
  counties: () => get<CountiesGeoJson>("/api/counties"),
  stats: () => get<Stats>("/api/dashboard/stats"),
  sources: () => get<SourceFreshness[]>("/api/sources"),
  procedures: (q: string) => get<ProcedureHit[]>("/api/procedures", { q }),
  waitingTimes: (params: { procedure?: string; procedureId?: number; location?: string }) =>
    get<WaitingAnswer>("/api/waiting-times", {
      procedure: params.procedure,
      procedure_id: params.procedureId?.toString(),
      location: params.location,
    }),
  waitingByCounty: (procedureId: number) =>
    get<WaitingCounties>("/api/waiting-times/counties", { procedure_id: String(procedureId) }),
  waitingOverview: () => get<WaitingOverview>("/api/waiting-times/overview"),
  waitingExamples: () => get<WaitingExamples>("/api/waiting-times/examples"),
  waitingTrend: (procedureId: number) =>
    get<WaitingTrend>("/api/waiting-times/trend", { procedure_id: String(procedureId) }),
  drugs: (q: string) => get<DrugHit[]>("/api/drugs", { q }),
  drugLookup: (name: string) => get<DrugAnswer>("/api/drugs/lookup", { name }),
  drugOverview: () => get<DrugOverview>("/api/drugs/overview"),
};

export function cardStreamUrl(conversationId: string): string {
  return `${API_BASE}/api/conversations/${encodeURIComponent(conversationId)}/cards/stream`;
}
