"use client";
import clsx from "clsx";
import type { LineComparisonRow } from "../lib/types";

type Props = { rows: LineComparisonRow[] };

function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${Math.round(v * 100)}%`;
}
function fmtMin(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${Math.round(v)} min`;
}
function verdictChip(v: LineComparisonRow["verdict"]) {
  if (v === "safer") return <span className="chip chip-ok">Safer</span>;
  if (v === "backup") return <span className="chip chip-warn">Backup</span>;
  return <span className="chip chip-bad">Avoid</span>;
}
function riskChip(r: LineComparisonRow["maintenance_risk"]) {
  if (r === "low") return <span className="chip chip-ok">Low</span>;
  if (r === "medium") return <span className="chip chip-warn">Medium</span>;
  return <span className="chip chip-bad">High</span>;
}

export default function LineComparisonTable({ rows }: Props) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-white/5 text-sm font-semibold text-white">
        Line comparison
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead className="text-left text-damm-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="px-5 py-3">Line</th>
              <th className="px-3 py-3 text-right">Cases</th>
              <th className="px-3 py-3 text-right">Avg OEE</th>
              <th className="px-3 py-3 text-right">Avg Overrun</th>
              <th className="px-3 py-3">Maintenance</th>
              <th className="px-5 py-3">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.line} className={clsx("border-t border-white/5", r.verdict === "safer" && "bg-damm-ok/[0.04]")}>
                <td className="px-5 py-3 font-semibold text-white">{r.line}</td>
                <td className="px-3 py-3 text-right font-mono text-damm-muted">{r.cases}</td>
                <td className="px-3 py-3 text-right font-mono text-white">{fmtPct(r.avg_oee)}</td>
                <td className="px-3 py-3 text-right font-mono text-damm-muted">{fmtMin(r.avg_overrun_minutes)}</td>
                <td className="px-3 py-3">{riskChip(r.maintenance_risk)}</td>
                <td className="px-5 py-3">{verdictChip(r.verdict)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-damm-muted text-sm">
                  Not enough cases across multiple lines.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
