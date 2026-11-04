// Mirrors the backend common tool response.
export type ToolStatus = "ok" | "ambiguous" | "not_found" | "no_data" | "error";

export interface Location {
  name: string;
  municipality: string;
  county: string;
}

export interface ToolResponse {
  status: ToolStatus;
  location: Location | null;
  /** A place carries its city or municipality: one name can repeat inside a county. */
  candidates: { name: string; county: string | null; municipality?: string | null; kind: "place" | "procedure" | "drug" }[];
  summary_hr: string;
  data: Record<string, unknown>;
  source: string;
  updated_at: string | null;
  card_id: string | null;
}

export interface Card extends Omit<ToolResponse, "card_id"> {
  card_id: string;
  tool: string;
  created_at: string;
  extra: Record<string, unknown>;
}

export interface Facility {
  name: string;
  type: string;
  type_hr: string;
  kind_hr: string;
  address: string;
  settlement: string;
  phone: string | null;
  distance_km: number;
}

export interface AccessRow {
  municipality: string;
  municipality_type: string;
  county: string;
  population: number;
  population_65_plus: number | null;
  share_65_plus_pct: number | null;
  pzz_practices: number;
  pzz_per_10k: number | null;
  gp_per_10k: number | null;
}

export interface Access {
  rows: AccessRow[];
  counties: string[];
  sources: Record<string, string>;
  is_demo: false;
}

export interface Bucket {
  key: string;
  real: number;
  demo: number;
}

export interface SourceFreshness {
  source_key: string;
  label: string;
  state: "ok" | "stale" | "error";
  last_success_at: string | null;
  age_minutes: number | null;
  interval_minutes: number | null;
  last_error: string | null;
  record_count: number | null;
  source_updated_at: string | null;
}

export interface Stats {
  window_days: number;
  by_day: Bucket[];
  by_week: Bucket[];
  by_tool: Bucket[];
  by_topic: Bucket[];
  by_county: Bucket[];
  by_profile: Bucket[];
  unanswered: Bucket[];
  totals: { real: number; demo: number };
  sources: SourceFreshness[];
}

export interface SessionToken {
  agent_id: string;
  conversation_token: string | null;
  signed_url: string | null;
}

export interface PlaceHit {
  name: string;
  municipality: string;
  county: string;
  population: number;
}

type Ring = [number, number][];
export interface CountyFeature {
  type: "Feature";
  properties: { code: string; name: string };
  geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
}
export interface CountiesGeoJson {
  type: "FeatureCollection";
  features: CountyFeature[];
}

/* ---------------------------------------------------------------- waiting lists (CEZIH) */
export type WaitRole = "nearest" | "sooner_nearby" | "soonest_croatia" | "nearby" | "soon" | "list";

export interface WaitOption {
  /** Missing in conversation cards stored before it was sent. */
  institution_id?: number;
  institution: string;
  spoken_name: string;
  settlement: string | null;
  county: string | null;
  distance_km: number | null;
  first_slot: string;
  first_slot_hr: string;
  wait_days: number;
  phone: string | null;
  email: string | null;
  web: string | null;
  list_updated_at: string | null;
  role: WaitRole;
}

export interface Provider {
  name: string;
  kind_hr: string;
  address: string | null;
  settlement: string;
  phone: string | null;
  distance_km: number | null;
}

export interface WaitingData {
  procedure: { id: number; name: string; category: string | null };
  origin: string | null;
  institutions_on_list: number;
  with_free_slot: number;
  median_days: number | null;
  booking_hr: string;
  other_providers: Provider[];
  options?: WaitOption[];
}

/** A list the answer does not offer, with the contact to ask about it (no e-mail for a private
 * practice). The fields after `settlement` are missing in cards stored before they were sent. */
export interface LeftOutList {
  institution_id?: number;
  institution: string;
  settlement: string | null;
  spoken_name?: string;
  distance_km?: number | null;
  phone?: string | null;
  email?: string | null;
}

export interface WaitingExtra {
  entries: WaitOption[];
  /** Lists without a free appointment, nearest first where the place is known. */
  without_slot: LeftOutList[];
  /** Lists only for children, with their first appointment (not among the answer's options). */
  children_only: (LeftOutList & { first_slot: string })[];
  providers: Provider[];
}

export interface WaitingAnswer extends Omit<ToolResponse, "data"> {
  data: Partial<WaitingData>;
  extra: Partial<WaitingExtra> | null;
}

/** A real case from today's lists: the nearest appointment and a much sooner one nearby. */
export interface WaitingExample {
  procedure: { id: number; name: string; label: string };
  location: Location;
  nearest: WaitOption;
  sooner: WaitOption;
  saving_days: number;
}

export interface WaitingExamples {
  status: "ok" | "no_data";
  examples: WaitingExample[];
  source: string;
  updated_at: string | null;
}

export interface ProcedureHit {
  id: number;
  name: string;
  category: string | null;
  institutions: number;
  median_days: number | null;
}

export interface CountyWait {
  county: string;
  institutions: number;
  with_free_slot: number;
  median_days: number | null;
  min_days: number | null;
}

export interface WaitingCounties {
  procedure: { id: number; name: string | null };
  counties: CountyWait[];
  national: { institutions: number; median_days: number | null };
  source: string;
  updated_at: string | null;
}

export interface WaitingOverview {
  longest: { id: number; name: string; category: string | null; median_days: number; institutions: number }[];
  quality: {
    procedures_with_lists: number;
    entries: number;
    not_updated: number;
    without_slot: number;
    institutions: number;
    institutions_located: number;
  };
  source: string;
  updated_at: string | null;
}

export interface WaitingTrend {
  procedure_id: number;
  days: { day: string; median_days: number | null; lists: number }[];
}

/* ---------------------------------------------------------------- medicines (HALMED, HZZO) */
export type HzzoList = "OLL" | "DLL" | "DLL+OLL";

export interface DrugProduct {
  name: string;
  brand: string;
  active_substance: string;
  form: string;
  rx: string | null;
  prescription: string | null;
  atc: string | null;
  hzzo_list: HzzoList | null;
  copay_min_eur: number | null;
  copay_max_eur: number | null;
  hospital_only: boolean;
  market_status: string | null;
  shortage: string | null;
  central: boolean;
  /** HALMED revoked the authorisation. Missing in conversation cards stored before it was sent. */
  revoked?: boolean;
  detail_url: string | null;
}

export interface DrugData {
  query_kind: "brand" | "substance";
  label: string;
  products: DrugProduct[];
  products_total: number;
  hzzo_lists_in_force: string | null;
  hzzo_lists_in_force_hr: string | null;
}

export interface DrugAnswer extends Omit<ToolResponse, "data"> {
  data: Partial<DrugData>;
  extra: { products?: DrugProduct[] } | null;
}

/** Counts are null before the first HALMED import ("no_data"), never zeros. */
export interface DrugOverview {
  status: "ok" | "no_data";
  total: number | null;
  rx: number | null;
  otc: number | null;
  on_lists: number | null;
  lists: { oll: number; dll: number; none: number } | null;
  shortage_forms: number | null;
  shortages: { label: string; substance: string; forms: number; hzzo_list: HzzoList | null }[];
  source: string;
  updated_at: string | null;
}

export interface DrugHit {
  label: string;
  substance: string;
  hzzo_list: HzzoList | null;
  rx: string | null;
}
