export type Product = {
  sku: string;
  name: string;
  format?: string | null;
  format_key?: string | null;
  family?: string | null;
  historical_lines: number[];
};

export type PlanOrder = {
  of: string;
  sku: string;
  product: string;
  start: string;
  end: string;
  volume: number;
  historical_oee: number;
  risk: "low" | "medium" | "high";
};

export type PlanLine = {
  line: number;
  orders: PlanOrder[];
};

export type ExecutedOrder = {
  of: string;
  sku: string;
  product: string;
  start: string;
  end: string;
  duration_hours: number;
  oee: number;
};

export type ExecutedHistoryLine = {
  line: number;
  orders: ExecutedOrder[];
};

export type SimulationStep = {
  step: number;
  name: string;
  status: "pending" | "running" | "complete";
  detail: string;
};

export type EvidenceLabel = "limited" | "fair" | "strong" | "very strong";

export type CleaningImpact = {
  cf_theoretical_minutes: number | null;
  historical_actual_changeover_minutes: number | null;
  limpieza_minutes: number | null;
  pnp_minutes: number | null;
  idle_minutes: number | null;
  execution_gap_minutes: number | null;
  cleaning_risk: "low" | "medium" | "high" | "unknown";
};

export type HistoricalBenchmark = {
  line_transition_benchmark_oee: number | null;
  line_format_benchmark_oee: number | null;
  months_used: string[];
  cases_used: number;
};

export type BusinessImpact = {
  decision: string;
  feasible: boolean;
  capacity_hours_saved: number;
  hl_protected: number;
  units_protected: number;
  recovery_hours_needed_naive: number;
  estimated_value_protected_eur: number;
  estimated_cost_of_naive_eur: number;
  estimated_cost_of_recommendation_eur: number;
  financial_delta_eur: number;
  assumptions: Record<string, any>;
};

export type CandidateResult = {
  candidate_id: string;
  rank: number | null;
  line: number;
  position_label: string;
  anchor_of: string | null;
  transition_type?: string | null;
  diagnostic_risk_pattern?: string | null;
  previous_format_key?: string | null;
  current_format_key?: string | null;
  feasible: boolean;
  infeasibility_reason?: string | null;
  decision?: string | null;
  predicted_oee: number;
  naive_predicted_oee?: number | null;
  oee_gain_vs_naive?: number | null;
  expected_downtime_minutes: number;
  changeover_overrun_minutes: number;
  maintenance_risk: "low" | "medium" | "high";
  confidence: number;
  evidence_strength: number;
  evidence_strength_label: EvidenceLabel;
  similar_cases_count: number;
  pain_score: number;
  verdict: "recommended" | "backup" | "avoid" | "infeasible";
  top_factors: string[];
  reasoning: string[];
  cleaning_impact: CleaningImpact | null;
  historical_benchmark: HistoricalBenchmark | null;
  business_impact: BusinessImpact | null;
  // cockpit timeline fields
  recovery_hours?: number | null;
  orders_moved: number;
  moves: { of: string; line: number; shift: string; why: string }[];
  proposed_plan: Record<string, ProposedSegment[]>;
  ghosts: Record<string, { of: string; start: number; w: number }[]>;
  naive_band: { line: number; start: number; w: number } | null;
};

export type ProposedSegment = {
  of: string;
  start: number;
  w: number;
  oee: number;
  kind: "anchor" | "ins" | "shift" | "planned";
};

export type SimulationSummary = {
  recommended_candidate_id: string;
  best_line: number;
  best_position: string;
  best_predicted_oee: number;
  naive_predicted_oee: number;
  estimated_oee_gain: number;
  downtime_avoided_minutes: number;
  confidence: number;
  evidence_strength: number;
  evidence_strength_label: EvidenceLabel;
  decision?: string | null;
  hl_protected?: number | null;
  financial_delta_eur?: number | null;
  capacity_hours_saved?: number | null;
  line_transition_benchmark_oee?: number | null;
  naive_line?: number | null;
  naive_anchor_of?: string | null;
  naive_band?: { line: number; start: number; w: number } | null;
  orders_analyzed?: number;
};

export type SimulationResponse = {
  run_id: string;
  steps: SimulationStep[];
  summary: SimulationSummary;
  ranked_candidates: CandidateResult[];
  infeasible_candidates: CandidateResult[];
};

export type PlanReviewTransition = {
  line: number;
  previous_of: string | null;
  current_of: string | null;
  previous_product: string | null;
  current_product: string | null;
  transition_type: string;
  feasible: boolean;
  infeasibility_reason: string | null;
  cf_theoretical_minutes: number | null;
  historical_actual_changeover_minutes: number | null;
  execution_gap_minutes: number | null;
  diagnostic_risk_pattern: string | null;
  diagnostic_risk_level: string | null;
  line_transition_benchmark_oee: number | null;
  estimated_value_at_risk_eur: number | null;
  capacity_hours_at_risk: number | null;
};

export type PlanReviewSwap = {
  from_line: number;
  to_line: number;
  transition_type: string;
  previous_of: string | null;
  current_of: string | null;
  rationale: string;
};

export type PlanReviewResponse = {
  plan_health_score: number;
  transitions_evaluated: number;
  expected_oee_leakage_points: number;
  estimated_value_at_risk_eur: number;
  capacity_hours_at_risk: number;
  risky_transitions: PlanReviewTransition[];
  cleaning_heavy_transitions: PlanReviewTransition[];
  infeasible_transitions: PlanReviewTransition[];
  recommended_swaps: PlanReviewSwap[];
  assumptions: Record<string, any>;
};

export type LearningRecord = {
  recommendation_id: string;
  run_id: string;
  timestamp: string;
  mode: string;
  selected_candidate_id: string;
  line: number;
  transition_type: string | null;
  predicted_oee: number | null;
  naive_predicted_oee: number | null;
  predicted_hl_protected: number | null;
  predicted_financial_delta_eur: number | null;
  planner_action: string;
  override_reason: string | null;
  actual_oee: number | null;
  actual_changeover_minutes: number | null;
  actual_observed_at: string | null;
  prediction_error_oee: number | null;
  miss_cause_hint: string | null;
  status: string;
};

export type LearningSummary = {
  total_recommendations: number;
  accepted: number;
  overridden: number;
  pending: number;
  average_abs_prediction_error_points: number | null;
  most_common_miss_cause: string | null;
  recent: LearningRecord[];
};

export type FactorItem = {
  factor: string;
  impact: "positive" | "neutral" | "negative";
  detail: string;
};

export type SimilarCase = {
  previous_of: string;
  current_of: string;
  line: number;
  oee: number;
  actual_changeover_minutes: number;
  theoretical_changeover_minutes: number;
  overrun_minutes: number;
};

export type ChangeoverDimension = {
  label: string;
  value?: string | null;
  detail: string;
  impact: "positive" | "neutral" | "negative";
};

export type ExplanationMetrics = {
  analogue_mean_oee?: number | null;
  naive_slot_mean_oee?: number | null;
  predicted_gain?: number | null;
};

export type OpenAIJson = {
  headline?: string | null;
  planner_explanation?: string | null;
  risk_note?: string | null;
  bullets: string[];
  limitations?: string | null;
};

export type ExplanationResponse = {
  candidate_id: string;
  title: string;
  llm_explanation: string;
  headline?: string;
  risk_note?: string;
  bullets: string[];
  openai_json: OpenAIJson;
  factors: FactorItem[];
  changeover_breakdown: ChangeoverDimension[];
  similar_cases: SimilarCase[];
  metrics: ExplanationMetrics;
  limitations: string[];
};

// ---------------- diagnostics

export type DiagnosticSummary = {
  orders_analyzed: number;
  worst_oee_trap: string | null;
  total_estimated_oee_cost: number | null;
  highest_risk_line: number | null;
  using_fallback_data: boolean;
};

export type TransitionRankRow = {
  transition_type: string;
  cases: number;
  avg_oee: number | null;
  baseline_oee: number | null;
  oee_cost_points: number | null;
  avg_actual_changeover_minutes: number | null;
  avg_theoretical_changeover_minutes: number | null;
  avg_overrun_minutes: number | null;
  risk_pattern: string;
  worst_line: number | null;
  maintenance_risk: "low" | "medium" | "high";
};

export type TransitionDetailSummary = {
  cases: number;
  avg_oee: number | null;
  baseline_oee: number | null;
  oee_cost_points: number | null;
  avg_actual_changeover_minutes: number | null;
  avg_theoretical_changeover_minutes: number | null;
  avg_overrun_minutes: number | null;
  confidence_label: string;
};

export type LineComparisonRow = {
  line: number;
  cases: number;
  avg_oee: number | null;
  avg_overrun_minutes: number | null;
  maintenance_risk: "low" | "medium" | "high";
  verdict: "safer" | "backup" | "avoid";
};

export type WorstOrderRow = {
  date: string | null;
  line: number;
  previous_of: string;
  current_of: string;
  previous_sku: string | null;
  current_sku: string | null;
  previous_product: string | null;
  current_product: string | null;
  oee: number | null;
  actual_changeover_minutes: number | null;
  theoretical_changeover_minutes: number | null;
  overrun_minutes: number | null;
  maintenance_flag: boolean;
};

export type TransitionDetailResponse = {
  transition_type: string;
  summary: TransitionDetailSummary;
  why_risky: string[];
  line_comparison: LineComparisonRow[];
  worst_orders: WorstOrderRow[];
};

export type OrderEvidenceResponse = {
  previous_of: string;
  current_of: string;
  line: number;
  date: string | null;
  transition_type: string;
  previous_sku: string | null;
  current_sku: string | null;
  previous_product: string | null;
  current_product: string | null;
  actual_oee: number | null;
  baseline_oee: number | null;
  oee_cost_points: number | null;
  theoretical_changeover_minutes: number | null;
  actual_changeover_minutes: number | null;
  overrun_minutes: number | null;
  par_tot_minutes: number | null;
  pnp_minutes: number | null;
  limpieza_minutes: number | null;
  idle_minutes: number | null;
  maintenance_flag: boolean;
  diagnostic_conclusion: string;
};
