"""LineWise FastAPI app — urgent demand → hybrid model → ranked candidates."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, List, Optional
from uuid import uuid4

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app import data_loader, diagnostics, learning_log, plan_review, sample_data
from app.cf_matrix import CFMatrix, load_cf_matrix
from app.explanation import build_explanation
from app.model import OEEModel
from app.optimizer import generate_candidates
from app.schemas import (
    ActualsRequest,
    DiagnosticSummary,
    ExplanationResponse,
    HealthResponse,
    LearningRecord,
    LearningSummary,
    OrderEvidenceResponse,
    PlanLine,
    PlanOrder,
    PlanResponse,
    PlanReviewResponse,
    PlannerActionRequest,
    Product,
    ProductsResponse,
    SimulationResponse,
    SimulationStep,
    SimulationSummary,
    TransitionDetailResponse,
    TransitionRankResponse,
    UrgentOrderRequest,
)
from app.transition_memory import build_transition_table

app = FastAPI(title="LineWise API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AppState:
    master: Optional[pd.DataFrame] = None
    transition_table: Optional[pd.DataFrame] = None
    products: List[Dict] = []
    plan: Dict = {"lines": []}
    model: OEEModel = OEEModel()
    cf_matrix: CFMatrix = CFMatrix()
    using_fallback: bool = False
    runs: Dict[str, Dict] = {}


state = AppState()


def _build_current_plan(master: pd.DataFrame) -> Dict:
    """Synthesize a 'current plan' + executed_history from the most recent OFs.

    The forward plan starts at "today" (UTC midnight). Executed history is
    sequenced BACKWARD from today, so the timeline can show a past zone
    (read-only) before a today divider.
    """
    if master is None or master.empty:
        return {"lines": [], "executed_history": []}
    df = master.copy()
    if "familia" in df.columns:
        df = df[~df["familia"].fillna("").astype(str).str.upper().isin(["LIMPIEZA", "DEFAULTVALUE", ""])]
    if "sku" in df.columns:
        df = df[~df["sku"].fillna("").astype(str).str.upper().isin(["LIMPIEZA", "DEFAULTVALUE"])]
    if "fecha_fin" in df.columns:
        df = df.sort_values("fecha_fin", ascending=False)

    from app.line_rules import normalize_format

    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    lines_out = []
    executed_out: List[Dict[str, Any]] = []

    def _row_to_order(r, start, end):
        oee_val = r.get("oee")
        oee_val = float(oee_val) if pd.notna(oee_val) else 0.6
        vol_val = r.get("hl")
        vol_val = float(vol_val) if pd.notna(vol_val) else 0.0
        cerveza = r.get("cerveza")
        marca = r.get("marca")
        sku_val = r.get("sku")
        product_name = (
            str(cerveza) if pd.notna(cerveza) and str(cerveza).strip().lower() not in ("defaultvalue", "nan")
            else (str(marca) if pd.notna(marca) else str(sku_val))
        )
        tipo_envase = str(r.get("tipo_envase")) if pd.notna(r.get("tipo_envase")) else None
        return {
            "of": str(r.get("of")),
            "sku": str(sku_val),
            "product": product_name,
            "envase": str(r.get("envase")) if pd.notna(r.get("envase")) else None,
            "tipo_envase": tipo_envase,
            "format_key": normalize_format(tipo_envase) or normalize_format(str(r.get("envase")) if pd.notna(r.get("envase")) else None),
            "familia": str(r.get("familia")) if pd.notna(r.get("familia")) else None,
            "marca": str(r.get("marca")) if pd.notna(r.get("marca")) else None,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "volume": vol_val,
            "historical_oee": oee_val,
            "risk": "low",
        }

    for line in [14, 17, 19]:
        sub = df[df["tren"] == line].head(10)
        if sub.empty:
            continue
        sub = sub.sort_values("fecha_fin") if "fecha_fin" in sub.columns else sub
        rows = sub.to_dict("records")
        # Split: last 4 → executed history, remainder → future plan
        executed_rows = rows[:4]
        plan_rows = rows[4:]

        # Future plan starting at today
        cursor = today
        plan_orders: List[Dict] = []
        for r in plan_rows:
            dur_min = float(r.get("par_tot_min") or 240.0)
            if dur_min <= 0 or np.isnan(dur_min):
                dur_min = 240.0
            start = cursor
            end = cursor + timedelta(minutes=dur_min)
            cursor = end + timedelta(minutes=30)
            plan_orders.append(_row_to_order(r, start, end))
        lines_out.append({"line": int(line), "orders": plan_orders})

        # Executed history ending at today (most recent on the right)
        end_cursor = today
        exec_list: List[Dict] = []
        # process newest-to-oldest, place on the timeline backwards
        for r in reversed(executed_rows):
            dur_min = float(r.get("par_tot_min") or 240.0)
            if dur_min <= 0 or np.isnan(dur_min):
                dur_min = 240.0
            end = end_cursor
            start = end - timedelta(minutes=dur_min)
            end_cursor = start - timedelta(minutes=30)
            o = _row_to_order(r, start, end)
            o["duration_hours"] = round(dur_min / 60.0, 2)
            exec_list.append({
                "of": o["of"],
                "sku": o["sku"],
                "product": o["product"],
                "start": o["start"],
                "end": o["end"],
                "duration_hours": o["duration_hours"],
                "oee": o["historical_oee"],
            })
        # ensure chronological order
        exec_list.sort(key=lambda x: x["start"])
        executed_out.append({"line": int(line), "orders": exec_list})

    return {"lines": lines_out, "executed_history": executed_out}


@app.on_event("startup")
def _startup() -> None:
    master = None
    try:
        master = data_loader.build_master_dataset()
    except Exception:
        master = None

    if master is None or master.empty or len(master) < 20:
        state.using_fallback = True
        master = sample_data.build_master()
        state.products = sample_data.build_products()
    else:
        state.using_fallback = False
        state.products = data_loader.get_products(master)

    state.master = master
    state.transition_table = build_transition_table(master)
    state.model = OEEModel().fit(state.transition_table)
    state.cf_matrix = load_cf_matrix()
    state.plan = _build_current_plan(master)
    try:
        data_loader.save_processed(master)
    except Exception:
        pass


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        data_loaded=state.master is not None and not state.master.empty,
        model_ready=state.model is not None,
        using_fallback_data=state.using_fallback,
    )


# ---------------------------------------------------- diagnostics endpoints


@app.get("/api/diagnostics/summary", response_model=DiagnosticSummary)
def diagnostics_summary() -> DiagnosticSummary:
    payload = diagnostics.get_diagnostic_summary(
        state.transition_table,
        master_size=int(len(state.master)) if state.master is not None else 0,
        using_fallback=state.using_fallback,
    )
    return DiagnosticSummary(**payload)


@app.get("/api/diagnostics/transitions", response_model=TransitionRankResponse)
def diagnostics_transitions(
    line: Optional[str] = None,
    min_cases: int = 3,
) -> TransitionRankResponse:
    line_int: Optional[int] = None
    if line and line.lower() != "all":
        try:
            line_int = int(line)
        except ValueError:
            line_int = None
    rows = diagnostics.rank_transition_types(
        state.transition_table, line=line_int, min_cases=min_cases
    )
    return TransitionRankResponse(transitions=rows)


@app.get(
    "/api/diagnostics/transitions/{transition_type}",
    response_model=TransitionDetailResponse,
)
def diagnostics_transition_detail(transition_type: str) -> TransitionDetailResponse:
    payload = diagnostics.get_transition_detail(state.transition_table, transition_type)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Transition type not found: {transition_type}")
    return TransitionDetailResponse(**payload)


@app.get(
    "/api/diagnostics/orders/{previous_of}/{current_of}",
    response_model=OrderEvidenceResponse,
)
def diagnostics_order_evidence(previous_of: str, current_of: str) -> OrderEvidenceResponse:
    payload = diagnostics.get_order_evidence(state.transition_table, previous_of, current_of)
    if payload is None:
        raise HTTPException(status_code=404, detail="Order transition not found")
    return OrderEvidenceResponse(**payload)


# ---------------------------------------------------- plan review


@app.post("/api/plan/review", response_model=PlanReviewResponse)
def post_plan_review() -> PlanReviewResponse:
    """Score the loaded plan as-is. No request body — uses the same /plan/current."""
    payload = plan_review.review_plan(state.plan, state.transition_table, state.cf_matrix)
    return PlanReviewResponse(**payload)


@app.get("/api/products", response_model=ProductsResponse)
def get_products() -> ProductsResponse:
    return ProductsResponse(products=[Product(**p) for p in state.products])


@app.get("/api/plan/current", response_model=PlanResponse)
def get_current_plan() -> PlanResponse:
    from app.schemas import ExecutedHistoryLine, ExecutedOrder
    plan_lines = []
    for line in state.plan.get("lines", []):
        orders = [
            PlanOrder(
                of=o["of"],
                sku=o["sku"],
                product=o["product"],
                start=o["start"],
                end=o["end"],
                volume=o["volume"],
                historical_oee=o["historical_oee"],
                risk=o.get("risk", "low"),
            )
            for o in line["orders"]
        ]
        plan_lines.append(PlanLine(line=line["line"], orders=orders))

    executed = [
        ExecutedHistoryLine(
            line=int(eh["line"]),
            orders=[ExecutedOrder(**o) for o in eh["orders"]],
        )
        for eh in state.plan.get("executed_history", [])
    ]
    return PlanResponse(lines=plan_lines, executed_history=executed)


def _product_info(sku: str) -> Dict:
    for p in state.products:
        if p["sku"] == sku:
            return p
    return {"sku": sku, "name": sku, "format": None, "family": None, "historical_lines": [14, 17, 19]}


def _build_steps(n_candidates: int, n_infeasible: int) -> List[SimulationStep]:
    return [
        SimulationStep(step=1, name="Load current plan", status="complete", detail="Loaded lines 14, 17, and 19 from the most recent execution."),
        SimulationStep(step=2, name="Apply line-format eligibility", status="complete", detail=f"Hard rules: Line 14 ↔ 1/2,1/3 · Line 17 ↔ 1/3 · Line 19 ↔ 1/2,1/3,2/5. Rejected {n_infeasible} candidate(s)."),
        SimulationStep(step=3, name="Look up CF theoretical changeover", status="complete", detail="Tabla CF Prat 2026 (LATA_BARRIL) is the planning truth; history median is the fallback."),
        SimulationStep(step=4, name="Look up diagnostic transition risk", status="complete", detail="Joined each candidate to the diagnostic memory of historical transition types."),
        SimulationStep(step=5, name="Search similar historical transitions", status="complete", detail=f"Pulled top-5 analogues per slot across {n_candidates} feasible candidate(s)."),
        SimulationStep(step=6, name="Predict OEE + historical benchmark", status="complete", detail="GBM (or fallback blend) prediction vs. the line+transition benchmark from past months."),
        SimulationStep(step=7, name="Estimate cleaning, capacity, € impact", status="complete", detail="Computed HL protected, capacity hours saved and estimated value vs. the naive plan."),
        SimulationStep(step=8, name="Rank by Sequence Pain Score", status="complete", detail="Combined OEE, overrun, downtime, maintenance, diagnostic risk and evidence penalties."),
        SimulationStep(step=9, name="Generate planner explanation", status="complete", detail="Prepared an evidence panel for the recommended slot."),
    ]


@app.post("/api/scenarios/simulate", response_model=SimulationResponse)
def simulate(req: UrgentOrderRequest) -> SimulationResponse:
    pinfo = _product_info(req.sku)
    result = generate_candidates(
        current_plan=state.plan,
        urgent={"sku": req.sku, "volume": req.volume, "deadline": req.deadline, "priority": req.priority},
        tt=state.transition_table,
        model=state.model,
        product_info=pinfo,
        cf_matrix=state.cf_matrix,
    )
    ranked = result["ranked"]
    infeasible = result.get("infeasible", [])
    if not ranked:
        # Everything got blocked by line-format rules. Still respond so the UI
        # can show the infeasibility panel.
        if not infeasible:
            raise HTTPException(status_code=400, detail="No candidate slots could be generated.")

    naive_idx = result["naive_idx"]
    naive = ranked[naive_idx] if (naive_idx is not None and ranked) else None
    best = ranked[0] if ranked else infeasible[0]

    run_id = f"SIM-{uuid4().hex[:6].upper()}"
    state.runs[run_id] = {
        "ranked": ranked,
        "infeasible": infeasible,
        "naive": naive,
        "request": req.model_dump(),
        "product_info": pinfo,
    }

    biz = best.get("business_impact") or {}
    bench = best.get("historical_benchmark") or {}
    from app.schemas import NaiveBand as _NB
    summary_naive_band = result.get("naive_band")
    summary = SimulationSummary(
        recommended_candidate_id=best["candidate_id"],
        best_line=best["line"],
        best_position=best["position_label"],
        best_predicted_oee=round(best["predicted_oee"], 4),
        naive_predicted_oee=round((naive or best)["predicted_oee"], 4),
        estimated_oee_gain=round(best["predicted_oee"] - (naive or best)["predicted_oee"], 4),
        downtime_avoided_minutes=round(((naive or best)["expected_downtime_minutes"] - best["expected_downtime_minutes"]), 1),
        confidence=round(best["confidence"], 3),
        evidence_strength=round(best["evidence_strength"], 3),
        evidence_strength_label=best["evidence_strength_label"],
        decision=best.get("decision"),
        hl_protected=biz.get("hl_protected"),
        financial_delta_eur=biz.get("financial_delta_eur"),
        capacity_hours_saved=biz.get("capacity_hours_saved"),
        line_transition_benchmark_oee=bench.get("line_transition_benchmark_oee"),
        naive_line=result.get("naive_line"),
        naive_anchor_of=result.get("naive_anchor_of"),
        naive_band=_NB(**summary_naive_band) if summary_naive_band else None,
        orders_analyzed=int(len(state.master)) if state.master is not None else 0,
    )

    from app.schemas import (
        BusinessImpact, CandidateResult, CleaningImpact, GhostSegment,
        HistoricalBenchmark, MoveAction, NaiveBand, ProposedSegment,
    )

    def to_candidate(c: Dict) -> CandidateResult:
        ci = c.get("cleaning_impact")
        hb = c.get("historical_benchmark")
        bi = c.get("business_impact")
        nb = c.get("naive_band")
        proposed = {
            k: [ProposedSegment(**s) for s in v]
            for k, v in (c.get("proposed_plan") or {}).items()
        }
        ghosts = {
            k: [GhostSegment(**g) for g in v]
            for k, v in (c.get("ghosts") or {}).items()
        }
        return CandidateResult(
            candidate_id=c["candidate_id"],
            rank=c.get("rank"),
            line=c["line"],
            position_label=c["position_label"],
            anchor_of=c.get("anchor_of"),
            transition_type=c.get("transition_type"),
            diagnostic_risk_pattern=c.get("diagnostic_risk_pattern"),
            previous_format_key=c.get("previous_format_key"),
            current_format_key=c.get("current_format_key"),
            feasible=c.get("feasible", True),
            infeasibility_reason=c.get("infeasibility_reason"),
            decision=c.get("decision"),
            predicted_oee=round(c["predicted_oee"], 4),
            naive_predicted_oee=round(c["naive_predicted_oee"], 4) if c.get("naive_predicted_oee") is not None else None,
            oee_gain_vs_naive=round(c["oee_gain_vs_naive"], 4) if c.get("oee_gain_vs_naive") is not None else None,
            expected_downtime_minutes=round(c["expected_downtime_minutes"], 1),
            changeover_overrun_minutes=round(c["changeover_overrun_minutes"], 1),
            maintenance_risk=c["maintenance_risk"],
            confidence=round(c["confidence"], 3),
            evidence_strength=round(c["evidence_strength"], 3),
            evidence_strength_label=c["evidence_strength_label"],
            similar_cases_count=c["similar_cases_count"],
            pain_score=round(c["pain_score"], 2),
            verdict=c["verdict"],
            top_factors=c.get("top_factors", []),
            reasoning=c.get("reasoning", []),
            cleaning_impact=CleaningImpact(**ci) if ci else None,
            historical_benchmark=HistoricalBenchmark(**hb) if hb else None,
            business_impact=BusinessImpact(**bi) if bi else None,
            recovery_hours=c.get("recovery_hours"),
            orders_moved=c.get("orders_moved", 0),
            moves=[MoveAction(**m) for m in (c.get("moves") or [])],
            proposed_plan=proposed,
            ghosts=ghosts,
            naive_band=NaiveBand(**nb) if nb else None,
        )

    out_ranked = [to_candidate(c) for c in ranked[:12]]
    out_infeasible = [to_candidate(c) for c in infeasible]

    # Log the recommendation so the learning page can show accept/override + actuals later
    try:
        rec = learning_log.record_recommendation(
            run_id=run_id,
            mode="rush_order",
            candidate_id=best["candidate_id"],
            line=int(best["line"]),
            transition_type=best.get("transition_type"),
            predicted_oee=float(best["predicted_oee"]),
            naive_predicted_oee=(float(naive["predicted_oee"]) if naive else None),
            hl_protected=biz.get("hl_protected"),
            financial_delta_eur=biz.get("financial_delta_eur"),
            request_payload=req.model_dump(),
        )
        state.runs[run_id]["recommendation_id"] = rec["recommendation_id"]
    except Exception:
        pass

    return SimulationResponse(
        run_id=run_id,
        steps=_build_steps(len(ranked), len(infeasible)),
        summary=summary,
        ranked_candidates=out_ranked,
        infeasible_candidates=out_infeasible,
    )


# ---------------------------------------------------- learning loop


@app.get("/api/learning/summary", response_model=LearningSummary)
def learning_summary() -> LearningSummary:
    s = learning_log.summary()
    s["recent"] = learning_log.list_records(limit=20)
    return LearningSummary(**s)


@app.post("/api/recommendations/{rec_id}/accept", response_model=LearningRecord)
def learning_accept(rec_id: str) -> LearningRecord:
    out = learning_log.update_action(rec_id, action="accepted")
    if not out:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return LearningRecord(**out)


@app.post("/api/recommendations/{rec_id}/override", response_model=LearningRecord)
def learning_override(rec_id: str, req: PlannerActionRequest) -> LearningRecord:
    out = learning_log.update_action(rec_id, action="overridden", override_reason=req.override_reason)
    if not out:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return LearningRecord(**out)


@app.post("/api/recommendations/{rec_id}/actuals", response_model=LearningRecord)
def learning_actuals(rec_id: str, req: ActualsRequest) -> LearningRecord:
    out = learning_log.update_actuals(
        rec_id,
        actual_oee=req.actual_oee,
        actual_changeover_minutes=req.actual_changeover_minutes,
        miss_cause_hint=req.miss_cause_hint,
    )
    if not out:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return LearningRecord(**out)


@app.get(
    "/api/scenarios/{run_id}/candidates/{candidate_id}/explain",
    response_model=ExplanationResponse,
)
def explain(run_id: str, candidate_id: str) -> ExplanationResponse:
    run = state.runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    cand = next((c for c in run["ranked"] if c["candidate_id"] == candidate_id), None)
    if cand is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    naive = run.get("naive")
    payload = build_explanation(cand, naive)
    return ExplanationResponse(**payload)
