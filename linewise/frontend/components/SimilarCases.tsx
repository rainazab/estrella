"use client";
import type { SimilarCase } from "../lib/types";

type Props = {
  cases: SimilarCase[];
};

export default function SimilarCases({ cases }: Props) {
  if (!cases || cases.length === 0) {
    return (
      <div className="text-sm text-damm-muted">
        No close historical analogues available.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm">
        <thead className="text-left text-damm-muted text-xs uppercase tracking-wider">
          <tr>
            <th className="py-2 pr-3">Previous OF</th>
            <th className="py-2 pr-3">Current OF</th>
            <th className="py-2 pr-3">Line</th>
            <th className="py-2 pr-3 text-right">OEE</th>
            <th className="py-2 pr-3 text-right">Actual CO</th>
            <th className="py-2 pr-3 text-right">Theoretical CO</th>
            <th className="py-2 pr-3 text-right">Overrun</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c, i) => (
            <tr key={i} className="border-t border-white/5">
              <td className="py-2 pr-3 font-mono text-xs text-damm-muted">
                {c.previous_of}
              </td>
              <td className="py-2 pr-3 font-mono text-xs text-damm-muted">
                {c.current_of}
              </td>
              <td className="py-2 pr-3 text-white">{c.line}</td>
              <td className="py-2 pr-3 text-right font-mono text-white">
                {Math.round(c.oee * 100)}%
              </td>
              <td className="py-2 pr-3 text-right font-mono text-damm-muted">
                {Math.round(c.actual_changeover_minutes)} min
              </td>
              <td className="py-2 pr-3 text-right font-mono text-damm-muted">
                {Math.round(c.theoretical_changeover_minutes)} min
              </td>
              <td className="py-2 pr-3 text-right font-mono text-damm-warn">
                {c.overrun_minutes >= 0 ? "+" : ""}
                {Math.round(c.overrun_minutes)} min
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
