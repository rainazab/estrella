"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { OrderEvidenceResponse } from "../lib/types";
import { getOrderEvidence } from "../lib/api";

type Props = {
  prevOf: string | null;
  curOf: string | null;
  onClose: () => void;
};

function pct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
function pts(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)} pts`;
}
function fmin(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${Math.round(v)} min`;
}

export default function OrderEvidenceDrawer({ prevOf, curOf, onClose }: Props) {
  const [data, setData] = useState<OrderEvidenceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const open = Boolean(prevOf && curOf);

  useEffect(() => {
    if (!prevOf || !curOf) return;
    setLoading(true);
    setErr(null);
    setData(null);
    getOrderEvidence(prevOf, curOf)
      .then(setData)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [prevOf, curOf]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 220, damping: 28 }}
            className="fixed top-0 right-0 h-full w-full md:w-[640px] bg-damm-slate border-l border-white/10 z-50 overflow-y-auto scrollbar-thin"
          >
            <div className="sticky top-0 bg-damm-slate/90 backdrop-blur px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-damm-muted">
                  Order evidence
                </div>
                {data ? (
                  <div className="mt-1 text-lg font-semibold text-white font-mono">
                    {data.previous_of} → {data.current_of}
                  </div>
                ) : null}
              </div>
              <button onClick={onClose} className="btn btn-ghost">
                Close
              </button>
            </div>

            <div className="px-6 py-6 space-y-6">
              {loading ? <div className="text-sm text-damm-muted">Loading evidence…</div> : null}
              {err ? <div className="text-sm text-damm-bad">Error: {err}</div> : null}

              {data ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { l: "Line", v: String(data.line) },
                      { l: "Date", v: data.date?.slice(0, 10) ?? "—" },
                      { l: "Transition type", v: data.transition_type },
                      { l: "Maintenance", v: data.maintenance_flag ? "Yes" : "No" },
                      { l: "Previous SKU", v: data.previous_sku ?? "—" },
                      { l: "Current SKU", v: data.current_sku ?? "—" },
                    ].map((m, i) => (
                      <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                        <div className="text-[10px] uppercase tracking-wider text-damm-muted">{m.l}</div>
                        <div className="text-sm text-white mt-0.5">{m.v}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Actual OEE" value={pct(data.actual_oee)} tone="default" />
                    <Stat label="Baseline OEE" value={pct(data.baseline_oee)} tone="default" />
                    <Stat
                      label="OEE Cost"
                      value={pts(data.oee_cost_points)}
                      tone={(data.oee_cost_points ?? 0) < 0 ? "bad" : "good"}
                    />
                  </div>

                  <div className="card p-4 border border-damm-accent/20">
                    <div className="text-xs uppercase tracking-wider text-damm-accent">
                      Changeover formula
                    </div>
                    <div className="font-mono text-sm text-damm-ink mt-2">
                      actual_changeover = PAR_TOT − (PNP + LIMPIEZA + IDLE)
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <Stat label="PAR TOT" value={fmin(data.par_tot_minutes)} small />
                      <Stat label="PNP" value={fmin(data.pnp_minutes)} small />
                      <Stat label="Limpieza" value={fmin(data.limpieza_minutes)} small />
                      <Stat label="Idle" value={fmin(data.idle_minutes)} small />
                      <Stat label="Theoretical CO" value={fmin(data.theoretical_changeover_minutes)} small />
                      <Stat label="Actual CO" value={fmin(data.actual_changeover_minutes)} small />
                      <Stat
                        label="Overrun"
                        value={fmin(data.overrun_minutes)}
                        small
                        tone={(data.overrun_minutes ?? 0) > 0 ? "warn" : "good"}
                      />
                    </div>
                  </div>

                  <div className="card p-4">
                    <div className="text-xs uppercase tracking-wider text-damm-muted mb-2">
                      Diagnostic conclusion
                    </div>
                    <p className="text-damm-ink leading-relaxed text-sm">
                      {data.diagnostic_conclusion}
                    </p>
                  </div>

                  <button
                    className="btn btn-primary w-full"
                    onClick={() => {
                      const qs = new URLSearchParams({
                        transition_type: data.transition_type,
                        avoid_line: String(data.line),
                      });
                      router.push(`/simulator?${qs.toString()}`);
                    }}
                  >
                    Use this insight in simulator →
                  </button>
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
  tone,
  small,
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "bad";
  small?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border bg-white/[0.02] p-3",
        tone === "good" && "border-damm-ok/30",
        tone === "warn" && "border-damm-warn/30",
        tone === "bad" && "border-damm-bad/30",
        !tone || tone === "default" ? "border-white/5" : "",
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-damm-muted">{label}</div>
      <div className={clsx("text-white mt-0.5 font-mono", small ? "text-sm" : "text-base")}>{value}</div>
    </div>
  );
}
