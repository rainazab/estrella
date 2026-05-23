from typing import Dict, List, Optional, Literal
from pydantic import BaseModel, Field


class Product(BaseModel):
    sku: str
    name: str
    format: Optional[str] = None
    format_key: Optional[str] = None
    family: Optional[str] = None
    historical_lines: List[int] = Field(default_factory=list)


class ProductsResponse(BaseModel):
    products: List[Product]


class PlanOrder(BaseModel):
    of: str
    sku: str
    product: str
    start: str
    end: str
    volume: float
    historical_oee: float
    risk: Literal["low", "medium", "high"] = "low"


class PlanLine(BaseModel):
    line: int
    orders: List[PlanOrder]


class ExecutedOrder(BaseModel):
    of: str
    sku: str
    product: str
    start: str
    end: str
    duration_hours: float
    oee: float


class ExecutedHistoryLine(BaseModel):
    line: int
    orders: List[ExecutedOrder] = Field(default_factory=list)


class PlanResponse(BaseModel):
    lines: List[PlanLine]
    executed_history: List[ExecutedHistoryLine] = Field(default_factory=list)


class UrgentOrderRequest(BaseModel):
    sku: str
    volume: float
    deadline: str
    priority: Literal["low", "medium", "high"] = "high"


class SimulationStep(BaseModel):
    step: int
    name: str
    status: Literal["pending", "running", "complete"] = "complete"
    detail: str


class CleaningImpact(BaseModel):
    cf_theoretical_minutes: Optional[float] = None
    historical_actual_changeover_minutes: Optional[float] = None
    limpieza_minutes: Optional[float] = None
    pnp_minutes: Optional[float] = None
    idle_minutes: Optional[float] = None
    execution_gap_minutes: Optional[float] = None
    cleaning_risk: Literal["low", "medium", "high", "unknown"] = "unknown"


class HistoricalBenchmark(BaseModel):
    line_transition_benchmark_oee: Optional[float] = None
    line_format_benchmark_oee: Optional[float] = None
    months_used: List[str] = Field(default_factory=list)
    cases_used: int = 0


class BusinessImpact(BaseModel):
    decision: str
    feasible: bool
    capacity_hours_saved: float
    hl_protected: float
    units_protected: int
    recovery_hours_needed_naive: float
    estimated_value_protected_eur: float
    estimated_cost_of_naive_eur: float
    estimated_cost_of_recommendation_eur: float
    financial_delta_eur: float
    assumptions: dict


class ProposedSegment(BaseModel):
    of: str
    start: float
    w: float
    oee: float
    kind: Literal["anchor", "ins", "shift", "planned"] = "planned"


class GhostSegment(BaseModel):
    of: str
    start: float
    w: float


class MoveAction(BaseModel):
    of: str
    line: int
    shift: str
    why: str


class NaiveBand(BaseModel):
    line: int
    start: float
    w: float


class CandidateResult(BaseModel):
    candidate_id: str
    rank: Optional[int] = None
    line: int
    position_label: str
    anchor_of: Optional[str] = None
    transition_type: Optional[str] = None
    diagnostic_risk_pattern: Optional[str] = None
    previous_format_key: Optional[str] = None
    current_format_key: Optional[str] = None
    feasible: bool = True
    infeasibility_reason: Optional[str] = None
    decision: Optional[str] = None
    predicted_oee: float
    naive_predicted_oee: Optional[float] = None
    oee_gain_vs_naive: Optional[float] = None
    expected_downtime_minutes: float
    changeover_overrun_minutes: float
    maintenance_risk: Literal["low", "medium", "high"]
    confidence: float
    evidence_strength: float
    evidence_strength_label: Literal["limited", "fair", "strong", "very strong"] = "fair"
    similar_cases_count: int = 0
    pain_score: float
    verdict: Literal["recommended", "backup", "avoid", "infeasible"]
    top_factors: List[str] = Field(default_factory=list)
    reasoning: List[str] = Field(default_factory=list)
    cleaning_impact: Optional[CleaningImpact] = None
    historical_benchmark: Optional[HistoricalBenchmark] = None
    business_impact: Optional[BusinessImpact] = None
    # NEW — for the cockpit timeline + recovery panel
    recovery_hours: Optional[float] = None
    orders_moved: int = 0
    moves: List[MoveAction] = Field(default_factory=list)
    proposed_plan: Dict[str, List[ProposedSegment]] = Field(default_factory=dict)
    ghosts: Dict[str, List[GhostSegment]] = Field(default_factory=dict)
    naive_band: Optional[NaiveBand] = None


class SimulationSummary(BaseModel):
    recommended_candidate_id: str
    best_line: int
    best_position: str
    best_predicted_oee: float
    naive_predicted_oee: float
    estimated_oee_gain: float
    downtime_avoided_minutes: float
    confidence: float
    evidence_strength: float
    evidence_strength_label: Literal["limited", "fair", "strong", "very strong"] = "fair"
    decision: Optional[str] = None
    hl_protected: Optional[float] = None
    financial_delta_eur: Optional[float] = None
    capacity_hours_saved: Optional[float] = None
    line_transition_benchmark_oee: Optional[float] = None
    naive_line: Optional[int] = None
    naive_anchor_of: Optional[str] = None
    naive_band: Optional[NaiveBand] = None
    orders_analyzed: int = 0


class SimulationResponse(BaseModel):
    run_id: str
    steps: List[SimulationStep]
    summary: SimulationSummary
    ranked_candidates: List[CandidateResult]
    infeasible_candidates: List[CandidateResult] = Field(default_factory=list)


class FactorItem(BaseModel):
    factor: str
    impact: Literal["positive", "neutral", "negative"]
    detail: str


class SimilarCase(BaseModel):
    previous_of: str
    current_of: str
    line: int
    oee: float
    actual_changeover_minutes: float
    theoretical_changeover_minutes: float
    overrun_minutes: float


class ChangeoverDimension(BaseModel):
    label: str
    detail: str
    value: Optional[str] = None
    impact: Literal["positive", "neutral", "negative"] = "neutral"


class ExplanationMetrics(BaseModel):
    analogue_mean_oee: Optional[float] = None
    naive_slot_mean_oee: Optional[float] = None
    predicted_gain: Optional[float] = None


class OpenAIJson(BaseModel):
    headline: Optional[str] = None
    planner_explanation: Optional[str] = None
    risk_note: Optional[str] = None
    bullets: List[str] = Field(default_factory=list)
    limitations: Optional[str] = None


class ExplanationResponse(BaseModel):
    candidate_id: str
    title: str
    llm_explanation: str
    headline: Optional[str] = None
    risk_note: Optional[str] = None
    bullets: List[str] = Field(default_factory=list)
    openai_json: OpenAIJson
    factors: List[FactorItem]
    changeover_breakdown: List[ChangeoverDimension] = Field(default_factory=list)
    similar_cases: List[SimilarCase]
    metrics: ExplanationMetrics
    limitations: List[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    data_loaded: bool
    model_ready: bool
    using_fallback_data: bool


# -------------------------------------------------- diagnostics


class DiagnosticSummary(BaseModel):
    orders_analyzed: int
    worst_oee_trap: Optional[str] = None
    total_estimated_oee_cost: Optional[float] = None
    highest_risk_line: Optional[int] = None
    using_fallback_data: bool


class TransitionRankRow(BaseModel):
    transition_type: str
    cases: int
    avg_oee: Optional[float] = None
    baseline_oee: Optional[float] = None
    oee_cost_points: Optional[float] = None
    avg_actual_changeover_minutes: Optional[float] = None
    avg_theoretical_changeover_minutes: Optional[float] = None
    avg_overrun_minutes: Optional[float] = None
    risk_pattern: str
    worst_line: Optional[int] = None
    maintenance_risk: Literal["low", "medium", "high"] = "low"


class TransitionRankResponse(BaseModel):
    transitions: List[TransitionRankRow]


class TransitionDetailSummary(BaseModel):
    cases: int
    avg_oee: Optional[float] = None
    baseline_oee: Optional[float] = None
    oee_cost_points: Optional[float] = None
    avg_actual_changeover_minutes: Optional[float] = None
    avg_theoretical_changeover_minutes: Optional[float] = None
    avg_overrun_minutes: Optional[float] = None
    confidence_label: str


class LineComparisonRow(BaseModel):
    line: int
    cases: int
    avg_oee: Optional[float] = None
    avg_overrun_minutes: Optional[float] = None
    maintenance_risk: Literal["low", "medium", "high"] = "low"
    verdict: Literal["safer", "backup", "avoid"] = "backup"


class WorstOrderRow(BaseModel):
    date: Optional[str] = None
    line: int
    previous_of: str
    current_of: str
    previous_sku: Optional[str] = None
    current_sku: Optional[str] = None
    previous_product: Optional[str] = None
    current_product: Optional[str] = None
    oee: Optional[float] = None
    actual_changeover_minutes: Optional[float] = None
    theoretical_changeover_minutes: Optional[float] = None
    overrun_minutes: Optional[float] = None
    maintenance_flag: bool = False


class TransitionDetailResponse(BaseModel):
    transition_type: str
    summary: TransitionDetailSummary
    why_risky: List[str]
    line_comparison: List[LineComparisonRow]
    worst_orders: List[WorstOrderRow]


class PlanReviewTransition(BaseModel):
    line: int
    previous_of: Optional[str] = None
    current_of: Optional[str] = None
    previous_product: Optional[str] = None
    current_product: Optional[str] = None
    transition_type: str
    feasible: bool
    infeasibility_reason: Optional[str] = None
    cf_theoretical_minutes: Optional[float] = None
    historical_actual_changeover_minutes: Optional[float] = None
    execution_gap_minutes: Optional[float] = None
    diagnostic_risk_pattern: Optional[str] = None
    diagnostic_risk_level: Optional[str] = None
    line_transition_benchmark_oee: Optional[float] = None
    estimated_value_at_risk_eur: Optional[float] = None
    capacity_hours_at_risk: Optional[float] = None


class PlanReviewSwap(BaseModel):
    from_line: int
    to_line: int
    transition_type: str
    previous_of: Optional[str] = None
    current_of: Optional[str] = None
    rationale: str


class LearningRecord(BaseModel):
    recommendation_id: str
    run_id: str
    timestamp: str
    mode: str
    selected_candidate_id: str
    line: int
    transition_type: Optional[str] = None
    predicted_oee: Optional[float] = None
    naive_predicted_oee: Optional[float] = None
    predicted_hl_protected: Optional[float] = None
    predicted_financial_delta_eur: Optional[float] = None
    planner_action: str = "pending"
    override_reason: Optional[str] = None
    actual_oee: Optional[float] = None
    actual_changeover_minutes: Optional[float] = None
    actual_observed_at: Optional[str] = None
    prediction_error_oee: Optional[float] = None
    miss_cause_hint: Optional[str] = None
    status: str = "awaiting_action"


class LearningSummary(BaseModel):
    total_recommendations: int
    accepted: int
    overridden: int
    pending: int
    average_abs_prediction_error_points: Optional[float] = None
    most_common_miss_cause: Optional[str] = None
    recent: List[LearningRecord] = Field(default_factory=list)


class PlannerActionRequest(BaseModel):
    override_reason: Optional[str] = None


class ActualsRequest(BaseModel):
    actual_oee: Optional[float] = None
    actual_changeover_minutes: Optional[float] = None
    miss_cause_hint: Optional[str] = None


class PlanReviewResponse(BaseModel):
    plan_health_score: float
    transitions_evaluated: int
    expected_oee_leakage_points: float
    estimated_value_at_risk_eur: float
    capacity_hours_at_risk: float
    risky_transitions: List[PlanReviewTransition]
    cleaning_heavy_transitions: List[PlanReviewTransition]
    infeasible_transitions: List[PlanReviewTransition]
    recommended_swaps: List[PlanReviewSwap]
    assumptions: dict


class OrderEvidenceResponse(BaseModel):
    previous_of: str
    current_of: str
    line: int
    date: Optional[str] = None
    transition_type: str
    previous_sku: Optional[str] = None
    current_sku: Optional[str] = None
    previous_product: Optional[str] = None
    current_product: Optional[str] = None
    actual_oee: Optional[float] = None
    baseline_oee: Optional[float] = None
    oee_cost_points: Optional[float] = None
    theoretical_changeover_minutes: Optional[float] = None
    actual_changeover_minutes: Optional[float] = None
    overrun_minutes: Optional[float] = None
    par_tot_minutes: Optional[float] = None
    pnp_minutes: Optional[float] = None
    limpieza_minutes: Optional[float] = None
    idle_minutes: Optional[float] = None
    maintenance_flag: bool = False
    diagnostic_conclusion: str
