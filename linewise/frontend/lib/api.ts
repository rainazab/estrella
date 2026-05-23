import type {
  DiagnosticSummary,
  ExplanationResponse,
  LearningRecord,
  LearningSummary,
  OrderEvidenceResponse,
  PlanLine,
  PlanReviewResponse,
  Product,
  SimulationResponse,
  TransitionDetailResponse,
  TransitionRankRow,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`API ${path} → ${r.status}: ${text}`);
  }
  return (await r.json()) as T;
}

export async function getProducts(): Promise<Product[]> {
  const r = await jsonFetch<{ products: Product[] }>("/api/products");
  return r.products;
}

export async function getPlan(): Promise<PlanLine[]> {
  const r = await jsonFetch<{ lines: PlanLine[] }>("/api/plan/current");
  return r.lines;
}

export async function simulate(payload: {
  sku: string;
  volume: number;
  deadline: string;
  priority: "low" | "medium" | "high";
}): Promise<SimulationResponse> {
  return jsonFetch<SimulationResponse>("/api/scenarios/simulate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function explainCandidate(
  runId: string,
  candidateId: string,
): Promise<ExplanationResponse> {
  return jsonFetch<ExplanationResponse>(
    `/api/scenarios/${runId}/candidates/${candidateId}/explain`,
  );
}

// ---------------- diagnostics

export async function getDiagnosticSummary(): Promise<DiagnosticSummary> {
  return jsonFetch<DiagnosticSummary>("/api/diagnostics/summary");
}

export async function getTransitions(opts?: {
  line?: string;
  minCases?: number;
}): Promise<TransitionRankRow[]> {
  const qs = new URLSearchParams();
  if (opts?.line) qs.set("line", opts.line);
  if (opts?.minCases != null) qs.set("min_cases", String(opts.minCases));
  const q = qs.toString();
  const r = await jsonFetch<{ transitions: TransitionRankRow[] }>(
    `/api/diagnostics/transitions${q ? `?${q}` : ""}`,
  );
  return r.transitions;
}

export async function getTransitionDetail(
  transitionType: string,
): Promise<TransitionDetailResponse> {
  return jsonFetch<TransitionDetailResponse>(
    `/api/diagnostics/transitions/${encodeURIComponent(transitionType)}`,
  );
}

export async function getOrderEvidence(
  previousOf: string,
  currentOf: string,
): Promise<OrderEvidenceResponse> {
  return jsonFetch<OrderEvidenceResponse>(
    `/api/diagnostics/orders/${encodeURIComponent(previousOf)}/${encodeURIComponent(currentOf)}`,
  );
}

// ---------------- plan review

export async function postPlanReview(): Promise<PlanReviewResponse> {
  return jsonFetch<PlanReviewResponse>("/api/plan/review", { method: "POST" });
}

// ---------------- learning

export async function getLearningSummary(): Promise<LearningSummary> {
  return jsonFetch<LearningSummary>("/api/learning/summary");
}

export async function acceptRecommendation(recId: string): Promise<LearningRecord> {
  return jsonFetch<LearningRecord>(`/api/recommendations/${recId}/accept`, {
    method: "POST",
  });
}

export async function overrideRecommendation(
  recId: string,
  reason?: string,
): Promise<LearningRecord> {
  return jsonFetch<LearningRecord>(`/api/recommendations/${recId}/override`, {
    method: "POST",
    body: JSON.stringify({ override_reason: reason ?? null }),
  });
}

export async function logActuals(
  recId: string,
  payload: { actual_oee?: number; actual_changeover_minutes?: number; miss_cause_hint?: string },
): Promise<LearningRecord> {
  return jsonFetch<LearningRecord>(`/api/recommendations/${recId}/actuals`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
