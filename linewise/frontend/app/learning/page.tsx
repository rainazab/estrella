"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import MetricCard from "../../components/MetricCard";
import { getLearningSummary, logActuals } from "../../lib/api";
import type { LearningRecord, LearningSummary } from "../../lib/types";

function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}
function fmtTs(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

const ACTION_BADGE: Record<string, string> = {
  accepted: "chip chip-ok",
  overridden: "chip chip-warn",
  pending: "chip chip-blue",
};

export default function LearningPage() {
  const [data, setData] = useState<LearningSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    getLearningSummary()
      .then(setData)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(reload, []);

  async function recordActuals(rec: LearningRecord) {
    const input = window.prompt(
      `Actual OEE for ${rec.recommendation_id} as a decimal (e.g. 0.71)?`,
      rec.actual_oee != null ? String(rec.actual_oee) : "",
    );
    if (!input) return;
    const v = Number(input);
    if (Number.isNaN(v)) return;
    const cause = window.prompt(
      "Miss cause hint (e.g. 'cleaning overrun', 'crew change') — optional:",
    ) || undefined;
    try {
      await logActuals(rec.recommendation_id, {
        actual_oee: v,
        miss_cause_hint: cause,
      });
      reload();
    } catch (e) {
      alert("Failed to save actuals: " + e);
    }
  }

  return (
    <main className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-damm-muted">
          Learning loop
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold text-white mt-1">
          How LineWise learns from past decisions
        </h1>
        <p className="mt-2 text-damm-muted max-w-2xl">
          Every recommendation is logged. When the planner accepts or overrides
          it, and later when actual OEE is observed, LineWise records the
          prediction error and the most common miss cause — so future
          recommendations can be tuned with concrete evidence.
        </p>
      </div>

      {loading ? <div className="text-sm text-damm-muted">Loading…</div> : null}
      {err ? <div className="card p-4 border border-damm-bad/40 text-damm-bad">{err}</div> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Total recommendations"
              value={String(data.total_recommendations)}
            />
            <MetricCard
              label="Accepted"
              value={String(data.accepted)}
              tone="good"
            />
            <MetricCard
              label="Overridden"
              value={String(data.overridden)}
              tone="warn"
            />
            <MetricCard
              label="Avg prediction error"
              value={
                data.average_abs_prediction_error_points != null
                  ? `${data.average_abs_prediction_error_points.toFixed(1)} pts`
                  : "—"
              }
              sub={
                data.most_common_miss_cause
                  ? `Most common miss: ${data.most_common_miss_cause}`
                  : "No actuals logged yet"
              }
              tone="default"
            />
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-white/5">
              <div className="text-sm font-semibold text-white">Recent recommendations</div>
              <div className="text-xs text-damm-muted">
                Latest first · click "Log actuals" to teach the model what really happened.
              </div>
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead className="text-left text-damm-muted text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3">ID</th>
                    <th className="px-3 py-3">When</th>
                    <th className="px-3 py-3">Mode</th>
                    <th className="px-3 py-3">Line / Transition</th>
                    <th className="px-3 py-3 text-right">Pred. OEE</th>
                    <th className="px-3 py-3 text-right">Actual OEE</th>
                    <th className="px-3 py-3 text-right">Error</th>
                    <th className="px-3 py-3">Action</th>
                    <th className="px-3 py-3">Miss cause</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r) => (
                    <tr key={r.recommendation_id} className="border-t border-white/5">
                      <td className="px-5 py-3 font-mono text-damm-muted">
                        {r.recommendation_id}
                      </td>
                      <td className="px-3 py-3 text-damm-muted">{fmtTs(r.timestamp)}</td>
                      <td className="px-3 py-3 text-damm-ink">{r.mode}</td>
                      <td className="px-3 py-3 text-damm-ink">
                        <div>Line {r.line}</div>
                        <div className="text-[10px] text-damm-muted">{r.transition_type ?? "—"}</div>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-white">
                        {fmtPct(r.predicted_oee)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-white">
                        {fmtPct(r.actual_oee)}
                      </td>
                      <td
                        className={clsx(
                          "px-3 py-3 text-right font-mono",
                          r.prediction_error_oee == null
                            ? "text-damm-muted"
                            : r.prediction_error_oee >= 0
                            ? "text-damm-ok"
                            : "text-damm-bad",
                        )}
                      >
                        {r.prediction_error_oee != null
                          ? `${r.prediction_error_oee >= 0 ? "+" : ""}${(r.prediction_error_oee * 100).toFixed(1)} pts`
                          : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <span className={ACTION_BADGE[r.planner_action] ?? "chip chip-blue"}>
                          {r.planner_action}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-damm-muted">
                        {r.miss_cause_hint ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => recordActuals(r)}
                          className="text-damm-accent text-xs underline-offset-2 hover:underline"
                        >
                          Log actuals →
                        </button>
                      </td>
                    </tr>
                  ))}
                  {data.recent.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-5 py-8 text-center text-damm-muted text-sm">
                        No recommendations logged yet. Run a rush-order simulation
                        and accept it to start the loop.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
