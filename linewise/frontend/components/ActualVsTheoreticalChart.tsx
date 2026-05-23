"use client";
import { motion } from "framer-motion";
import type { WorstOrderRow } from "../lib/types";

type Props = { orders: WorstOrderRow[] };

export default function ActualVsTheoreticalChart({ orders }: Props) {
  const rows = orders.slice(0, 5);
  const maxV = Math.max(
    1,
    ...rows.flatMap((r) => [r.actual_changeover_minutes ?? 0, r.theoretical_changeover_minutes ?? 0]),
  );

  return (
    <div className="card p-5">
      <div className="text-sm font-semibold text-white">
        Actual vs. theoretical changeover
      </div>
      <div className="text-xs text-damm-muted mt-1 mb-4">
        Top 5 worst historical orders for this transition.
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-damm-muted">No historical orders to plot.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r, i) => {
            const actual = r.actual_changeover_minutes ?? 0;
            const theo = r.theoretical_changeover_minutes ?? 0;
            const overrun = r.overrun_minutes ?? actual - theo;
            return (
              <div key={`${r.previous_of}_${r.current_of}_${i}`}>
                <div className="text-[11px] text-damm-muted flex justify-between font-mono">
                  <span>L{r.line} · {r.previous_of} → {r.current_of}</span>
                  <span>
                    {Math.round(actual)} min actual · {Math.round(theo)} min theoretical · overrun {overrun >= 0 ? "+" : ""}{Math.round(overrun)} min
                  </span>
                </div>
                <div className="relative h-3 mt-1 rounded-md bg-white/5 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(theo / maxV) * 100}%` }}
                    transition={{ duration: 0.4, delay: i * 0.05 }}
                    className="absolute inset-y-0 left-0 bg-damm-accent/70"
                    title="Theoretical"
                  />
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(actual / maxV) * 100}%` }}
                    transition={{ duration: 0.4, delay: i * 0.05 + 0.1 }}
                    className="absolute inset-y-0 left-0 bg-damm-red/60 mix-blend-screen"
                    title="Actual"
                  />
                </div>
              </div>
            );
          })}
          <div className="flex gap-4 text-xs text-damm-muted mt-2">
            <span className="flex items-center gap-2">
              <span className="inline-block h-2 w-3 rounded bg-damm-accent/70" /> Theoretical
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block h-2 w-3 rounded bg-damm-red/60" /> Actual
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
