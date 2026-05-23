"use client";
import clsx from "clsx";
import type { WorstOrderRow } from "../lib/types";

type Props = {
  orders: WorstOrderRow[];
  onSelect: (prev: string, cur: string) => void;
};

function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}
function fmtMin(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${Math.round(v)} min`;
}
function fmtDate(v: string | null): string {
  if (!v) return "—";
  return v.slice(0, 10);
}

export default function HistoricalOrdersTable({ orders, onSelect }: Props) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-white/5 text-sm font-semibold text-white flex items-center justify-between">
        <span>Historical orders for this transition</span>
        <span className="text-xs text-damm-muted">Click for evidence</span>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead className="text-left text-damm-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="px-5 py-3">Date</th>
              <th className="px-3 py-3">Line</th>
              <th className="px-3 py-3">Prev OF → Cur OF</th>
              <th className="px-3 py-3">Prev Product</th>
              <th className="px-3 py-3">Cur Product</th>
              <th className="px-3 py-3 text-right">OEE</th>
              <th className="px-3 py-3 text-right">Actual CO</th>
              <th className="px-3 py-3 text-right">Theoretical</th>
              <th className="px-3 py-3 text-right">Overrun</th>
              <th className="px-5 py-3">Maint</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr
                key={`${o.previous_of}_${o.current_of}`}
                onClick={() => onSelect(o.previous_of, o.current_of)}
                className="border-t border-white/5 hover:bg-white/[0.03] cursor-pointer"
              >
                <td className="px-5 py-3 font-mono text-damm-muted">{fmtDate(o.date)}</td>
                <td className="px-3 py-3 text-white">{o.line}</td>
                <td className="px-3 py-3 font-mono text-xs text-damm-ink">
                  {o.previous_of} → {o.current_of}
                </td>
                <td className="px-3 py-3 text-damm-ink truncate max-w-[14ch]">{o.previous_product ?? o.previous_sku ?? "—"}</td>
                <td className="px-3 py-3 text-damm-ink truncate max-w-[14ch]">{o.current_product ?? o.current_sku ?? "—"}</td>
                <td className="px-3 py-3 text-right font-mono text-white">{fmtPct(o.oee)}</td>
                <td className="px-3 py-3 text-right font-mono text-damm-muted">{fmtMin(o.actual_changeover_minutes)}</td>
                <td className="px-3 py-3 text-right font-mono text-damm-muted">{fmtMin(o.theoretical_changeover_minutes)}</td>
                <td className={clsx("px-3 py-3 text-right font-mono", (o.overrun_minutes ?? 0) > 0 ? "text-damm-warn" : "text-damm-ok")}>{fmtMin(o.overrun_minutes)}</td>
                <td className="px-5 py-3">
                  {o.maintenance_flag ? (
                    <span className="chip chip-warn">Yes</span>
                  ) : (
                    <span className="chip chip-ok">No</span>
                  )}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={10} className="px-5 py-8 text-center text-damm-muted text-sm">
                  No orders found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
