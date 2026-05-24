"use client";
import { motion } from "framer-motion";

const STAGES = [
  {
    title: "1. Sources",
    detail:
      "Per-OF Excel exports — OEE, Tiempo, Volumen, Cambios, Mantenimiento, Planificado, CF matrix.",
    items: [
      "OEE 14_17_19_ 2025.xlsx",
      "Tiempo 14_17_19_ 2025.xlsx (WOID → OF)",
      "Volumen 14_17_19_ 2025.xlsx",
      "Cambios 14_17_19_ 2025.xlsx",
      "Mantenimiento 14_17_19_ 2025.xlsx",
      "Tabla CF Prat 2026 (if parseable)",
    ],
  },
  {
    title: "2. Master table",
    detail:
      "OEE is the spine. Tiempo joins on OF after WOID rename. Cambios is collapsed to one row per OF. Per-order granularity.",
    items: [
      "Lowercase + accent-strip + fuzzy column matching",
      "Drop LIMPIEZA / DefaultValue placeholders",
      "Hours → minutes for PAR_TOT, PNP, Limpieza, Idle",
    ],
  },
  {
    title: "3. Transition memory",
    detail:
      "Per line, sorted by date. Each row is (prev OF → cur OF) with derived transition type and computed evidence.",
    items: [
      "actual_changeover = PAR_TOT − (PNP + Limpieza + Idle)",
      "theoretical = median(actual) by (line, transition_type)",
      "baseline_oee = leave-one-out per (line, current_sku)",
      "oee_cost_points = (actual − baseline) × 100",
    ],
  },
  {
    title: "4. Diagnostics",
    detail:
      "Group transition memory by transition type → rank by OEE cost → expose risk pattern + line comparison + worst orders.",
    items: [
      "Risk patterns: Changeover overrun · Cleaning heavy · PNP spike · Maintenance sensitive",
      "Line verdict per transition: Safer / Backup / Avoid",
      "Confidence label scales with case count",
    ],
  },
  {
    title: "5. Predict + recommend",
    detail:
      "Per candidate slot: similarity search → GBM OEE predictor → Sequence Pain Score with diagnostic risk penalty.",
    items: [
      "Features: line · transition_type · theoretical CO · analogue OEE/overrun · volume · month/weekday",
      "Pain = (1-OEE)·100 + 0.25·overrun + 0.10·downtime + maintenance + cleaning + diagnostic + uncertainty",
      "Naive baseline = first chronological slot on the SKU's historical line",
    ],
  },
  {
    title: "6. Explanation",
    detail:
      "Local model picks the recommendation. OpenAI only turns the computed facts into planner-friendly language.",
    items: [
      "OpenAI receives a compact facts JSON — no raw rows",
      "Falls back to a deterministic explanation when OPENAI_API_KEY is missing",
      "Output: headline · planner_explanation · risk_note · bullets · limitations",
    ],
  },
];

export default function AboutModelPage() {
  return (
    <main className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-damm-muted">
          Model flow
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold text-white mt-1">
          How LineWise works
        </h1>
        <p className="mt-2 text-damm-muted max-w-2xl">
          LineWise first learns which transitions historically hurt OEE, then
          uses that learned factory memory to simulate urgent-order placements
          and recommend the line and slot with the lowest expected operational
          damage.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {STAGES.map((s, i) => (
          <motion.div
            key={s.title}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="card p-5"
          >
            <div className="text-sm font-semibold text-white">{s.title}</div>
            <div className="text-sm text-damm-muted mt-1">{s.detail}</div>
            <ul className="mt-3 space-y-1.5">
              {s.items.map((it) => (
                <li key={it} className="text-xs text-damm-ink/90 flex gap-2">
                  <span className="text-damm-accent">›</span>
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>

      <div className="card p-5 border border-damm-warn/30">
        <div className="text-xs uppercase tracking-wider text-damm-warn">
          What this estimate can't see
        </div>
        <ul className="text-sm text-damm-ink/90 mt-2 space-y-1">
          <li>· Crew experience and shift staffing.</li>
          <li>· Downstream micro-stoppages not captured by PNP.</li>
          <li>· External constraints (logistics, raw-material availability).</li>
        </ul>
      </div>
    </main>
  );
}
