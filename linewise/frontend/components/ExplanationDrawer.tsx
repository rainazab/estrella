"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import clsx from "clsx";
import type { ChangeoverDimension, ExplanationResponse } from "../lib/types";
import { explainCandidate } from "../lib/api";
import SimilarCases from "./SimilarCases";

type Props = {
  runId: string | null;
  candidateId: string | null;
  onClose: () => void;
};

const impactClass: Record<string, string> = {
  positive: "border-damm-ok/30 bg-damm-ok/5 text-damm-ok",
  neutral: "border-white/10 bg-white/5 text-damm-muted",
  negative: "border-damm-bad/30 bg-damm-bad/5 text-damm-bad",
};

function pct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

export default function ExplanationDrawer({
  runId,
  candidateId,
  onClose,
}: Props) {
  const [data, setData] = useState<ExplanationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = Boolean(runId && candidateId);

  useEffect(() => {
    if (!runId || !candidateId) return;
    setLoading(true);
    setErr(null);
    setData(null);
    explainCandidate(runId, candidateId)
      .then(setData)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [runId, candidateId]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 220, damping: 28 }}
            className="fixed top-0 right-0 h-full w-full md:w-[680px] bg-damm-slate border-l border-white/10 z-50 overflow-y-auto scrollbar-thin"
          >
            <div className="sticky top-0 bg-damm-slate/90 backdrop-blur px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-damm-muted">
                  Evidence panel
                </div>
                {data ? (
                  <div className="mt-1 text-lg font-semibold text-white">{data.title}</div>
                ) : null}
              </div>
              <button onClick={onClose} className="btn btn-ghost">
                Close
              </button>
            </div>

            <div className="px-6 py-6 space-y-6">
              {loading ? <div className="text-sm text-damm-muted">Building explanation…</div> : null}
              {err ? <div className="text-sm text-damm-bad">Error: {err}</div> : null}

              {data ? (
                <>
                  {data.headline ? (
                    <div className="card p-4 border border-damm-accent/30">
                      <div className="text-xs uppercase tracking-wider text-damm-accent">
                        Headline
                      </div>
                      <div className="mt-1 text-white">{data.headline}</div>
                    </div>
                  ) : null}

                  <div>
                    <div className="text-xs uppercase tracking-wider text-damm-muted mb-2">
                      Why this slot
                    </div>
                    <p className="text-damm-ink leading-relaxed">{data.llm_explanation}</p>
                    {data.risk_note ? (
                      <div className="mt-3 text-sm text-damm-warn">{data.risk_note}</div>
                    ) : null}
                    {data.bullets && data.bullets.length > 0 ? (
                      <ul className="mt-4 space-y-1.5">
                        {data.bullets.map((b, i) => (
                          <li key={i} className="text-sm text-damm-ink/90 flex gap-2">
                            <span className="text-damm-accent">›</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  {data.metrics ? (
                    <div className="grid grid-cols-3 gap-3">
                      <Stat label="Analogue mean OEE" value={pct(data.metrics.analogue_mean_oee)} />
                      <Stat label="Naive slot mean OEE" value={pct(data.metrics.naive_slot_mean_oee)} />
                      <Stat
                        label="Predicted gain"
                        value={pct(data.metrics.predicted_gain)}
                        tone={(data.metrics.predicted_gain ?? 0) > 0 ? "good" : "warn"}
                      />
                    </div>
                  ) : null}

                  {data.changeover_breakdown && data.changeover_breakdown.length > 0 ? (
                    <div>
                      <div className="text-xs uppercase tracking-wider text-damm-muted mb-2">
                        Changeover breakdown
                      </div>
                      <div className="grid gap-2">
                        {data.changeover_breakdown.map((d: ChangeoverDimension, i) => (
                          <div
                            key={i}
                            className={clsx(
                              "rounded-xl border px-3 py-2 text-sm",
                              impactClass[d.impact] ?? impactClass.neutral,
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <div className="font-medium">{d.label}</div>
                              <div className="font-mono text-xs">{d.value ?? "—"}</div>
                            </div>
                            <div className="text-xs text-damm-ink/80 mt-0.5">{d.detail}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <div className="text-xs uppercase tracking-wider text-damm-muted mb-2">
                      Factors
                    </div>
                    <div className="grid gap-2">
                      {data.factors.map((f, i) => (
                        <div
                          key={i}
                          className={clsx(
                            "rounded-xl border px-3 py-2 text-sm flex items-start gap-3",
                            impactClass[f.impact] ?? impactClass.neutral,
                          )}
                        >
                          <div className="font-medium min-w-[150px]">{f.factor}</div>
                          <div className="text-damm-ink/90 text-xs">{f.detail}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-wider text-damm-muted mb-2">
                      Similar historical cases
                    </div>
                    <SimilarCases cases={data.similar_cases} />
                  </div>

                  {data.limitations && data.limitations.length > 0 ? (
                    <div className="card p-4 border border-damm-warn/30">
                      <div className="text-xs uppercase tracking-wider text-damm-warn mb-1">
                        What this estimate can't see
                      </div>
                      <ul className="text-sm text-damm-ink/90 space-y-1 mt-2">
                        {data.limitations.map((l, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-damm-warn">·</span>
                            <span>{l}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn";
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border bg-white/[0.02] p-3",
        tone === "good" && "border-damm-ok/30",
        tone === "warn" && "border-damm-warn/30",
        tone === "default" && "border-white/5",
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-damm-muted">{label}</div>
      <div className="text-base text-white mt-0.5 font-mono">{value}</div>
    </div>
  );
}
