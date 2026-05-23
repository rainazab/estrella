/**
 * Frozen contract between the backend export script and the cockpit UI.
 *
 * The backend produces `frontend/public/data.json` via
 *   `cd backend && python -m app.export_data_json`
 * The cockpit calls `loadData()` once on mount and reads the entire payload
 * from that file. No per-action API calls happen in the cockpit.
 *
 * Adding or removing top-level keys here is a CONTRACT CHANGE — bump the
 * version in `metadata.contract_version` and update the export script.
 */

// ------------ small types ------------

export type Seg = {
  of: string;
  start: number; // day-offset (executed: 0..N old→new; plan: 0..N today→ahead)
  w: number; // width in days
  sku?: string | null;
  vol?: number;
  oee?: number; // 0..1; absent for clean/maint blocks
  kind?: "anchor" | "ins" | "shift" | "planned" | string;
};

export type Ghost = {
  of: string;
  start: number;
  w: number;
};

export type NaiveBand = {
  line: string; // line key as string
  start: number;
  w: number;
};

export type Move = {
  of: string;
  line: number;
  shift: string;
  why: string;
};

// ------------ urgent orders ------------

export type UrgentOrder = {
  of: string;
  status: "urgent" | "queued";
  sku: string;
  productSku: string;
  units: number;
  hl: number;
  due: string;
  volume_hl: number;
  format_key?: string | null;
};

// ------------ baselines / context ------------

export type LineBaseline = {
  avg_oee: number | null;
  avg_changeover_minutes: number | null;
  avg_limpieza_minutes: number | null;
  avg_pnp_minutes: number | null;
  production_orders: number;
  supports_formats: string[];
  avg_overrun_minutes?: number | null;
  throughput_hl_per_hour?: number;
  historical_orders?: number;
};

// Year → Month → Line → avg OEE
export type YearCompare = Record<string, Record<string, Record<string, number>>>;

// ------------ recommendations ------------

export type EvidenceBreakdown = {
  name: string;
  pct: number; // 0..100 visual width
  band: "lo" | "hi";
  val: string;
};

export type EvidenceAnalogue = {
  of: string;
  previous_of?: string;
  date: string;
  line: string;
  type: string;
  principal?: string | null;
  actual_changeover_minutes?: number | null;
  oee: number;
};

export type Evidence = {
  reason: string;
  headline?: string | null;
  riskNote?: string | null;
  bullets?: string[];
  breakdown: EvidenceBreakdown[];
  analogues: EvidenceAnalogue[];
  n: number;
  analogueMean: string;
  naiveMean: string;
  gain: string;
  scope?: string;
  lineBaselineOee?: number | null;
  transitionTypeStats?: any;
  transitionComponents?: string[];
  cfTheoreticalMinutes?: number | null;
  limitations: string[];
};

export type Recovery = {
  line: string;
  start: number;
  w: number;
  hours: number;
  note: string;
};

export type Recommendation = {
  line: string; // human label, e.g. "Line 17"
  position: string; // "after PRT9900016879-M"
  oeeDelta: string; // "+6.2" or "−0.4"
  oeeGood: boolean;
  deadline: string;
  ordersMoved: number;
  naiveBand: NaiveBand | null;
  plan: Record<string, Seg[]>; // per-line segments under this candidate
  ghosts: Record<string, Ghost[]>;
  recovery: Recovery;
  moves: Move[];
  decision?: string | null;
  predictedOee: number;
  naivePredictedOee?: number | null;
  evidenceStrengthLabel?: string | null;
  diagnosticRiskPattern?: string | null;
  transitionType?: string | null;
  cleaningImpact?: any | null;
  businessImpact?: any | null;
  historicalBenchmark?: any | null;
  reasoning?: string[];
  topFactors?: string[];
  evidence: Evidence;
};

// ------------ objectives ------------

export type Objective = {
  label: string;
  icon: string;
  order: string[]; // line keys in ranked order, e.g. ["17","14","19"]
  notes: Record<string, string>; // per-line short note
};

// ------------ top-level payload ------------

export type LineWiseData = {
  urgentOrders: UrgentOrder[];
  lineBaseline: Record<string, LineBaseline>;
  lineCentre: Record<string, string>;
  yearCompare: YearCompare;
  executedHistory: Record<string, Seg[]>;
  basePlan: Record<string, Seg[]>;
  recommendations: Record<string, Recommendation>;
  objectives: Record<string, Objective>;
  // optional, not part of the strict contract — useful for the UI
  metadata?: {
    exported_at?: string;
    using_fallback_data?: boolean;
    master_rows?: number;
    transitions?: number;
    transitions_analyzed?: number;
    cf_matrix_loaded?: boolean;
    primary_urgent_of?: string;
    naive_line?: number | null;
  };
  infeasibleByLine?: Record<string, string>;
  planReview?: PlanReview;
};

export type PlanReviewRiskItem = {
  previous_of: string;
  current_of: string;
  previous_sku: string | null;
  current_sku: string | null;
  marker_start: number;
  marker_w: number;
  transition_type: string;
  principal_label: string | null;
  cf_theoretical_minutes: number | null;
  line_transition_benchmark_oee: number | null;
  line_baseline_oee: number | null;
  oee_damage_pts: number | null;
  mean_actual_changeover_minutes: number | null;
  mean_limpieza_minutes: number | null;
  mean_pnp_minutes: number | null;
  risk_level: "none" | "low" | "med" | "high";
  risk_reasons: string[];
  cases: number;
};

export type PlanReview = {
  risky_by_line: Record<string, PlanReviewRiskItem[]>;
  plan_health_score: number;
  total_risky: number;
  total_cleaning_heavy: number;
  summary: string;
};

// ------------ loader + fallback ------------

/**
 * Minimal valid LineWiseData used when /data.json is missing.
 * Just enough to render the queue + empty stage without crashing.
 */
export const FALLBACK_DATA: LineWiseData = {
  urgentOrders: [
    {
      of: "DEMO-001",
      status: "urgent",
      sku: "Estrella Damm · lata 33cl (demo)",
      productSku: "DEMO",
      units: 18000,
      hl: 594,
      due: "—",
      volume_hl: 594,
      format_key: "1/3",
    },
  ],
  lineBaseline: {
    "14": { avg_oee: 0.54, avg_changeover_minutes: 10, avg_limpieza_minutes: 0, avg_pnp_minutes: 0, production_orders: 0, supports_formats: ["1/2", "1/3"] },
    "17": { avg_oee: 0.55, avg_changeover_minutes: 14, avg_limpieza_minutes: 0, avg_pnp_minutes: 0, production_orders: 0, supports_formats: ["1/3"] },
    "19": { avg_oee: 0.52, avg_changeover_minutes: 17, avg_limpieza_minutes: 0, avg_pnp_minutes: 0, production_orders: 0, supports_formats: ["1/2", "1/3", "2/5"] },
  },
  lineCentre: { "14": "CF Prat", "17": "CF Prat", "19": "CF Prat" },
  yearCompare: {},
  executedHistory: { "14": [], "17": [], "19": [] },
  basePlan: { "14": [], "17": [], "19": [] },
  recommendations: {},
  objectives: {},
  metadata: { using_fallback_data: true },
};

/**
 * Load the static cockpit payload.
 *
 *   - Tries `fetch("/data.json")`. If found, returns it.
 *   - Otherwise returns the embedded `FALLBACK_DATA` so the UI still boots.
 *
 * Callers should treat the result as immutable.
 */
export async function loadData(): Promise<LineWiseData> {
  try {
    const res = await fetch("/data.json", { cache: "no-store" });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[linewise] /data.json returned ${res.status}; using FALLBACK_DATA`,
      );
      return FALLBACK_DATA;
    }
    const json = (await res.json()) as LineWiseData;
    // Light defensive defaults — every contract key must be present
    return {
      urgentOrders: json.urgentOrders ?? [],
      lineBaseline: json.lineBaseline ?? {},
      lineCentre: json.lineCentre ?? {},
      yearCompare: json.yearCompare ?? {},
      executedHistory: json.executedHistory ?? {},
      basePlan: json.basePlan ?? {},
      recommendations: json.recommendations ?? {},
      objectives: json.objectives ?? {},
      metadata: json.metadata,
      infeasibleByLine: json.infeasibleByLine,
      planReview: json.planReview,
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[linewise] failed to fetch /data.json — using FALLBACK_DATA", e);
    return FALLBACK_DATA;
  }
}
