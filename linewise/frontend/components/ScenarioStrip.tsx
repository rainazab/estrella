"use client";
import type { LineWiseData, Recommendation } from "../lib/contract";

type Props = {
  data: LineWiseData;
  selectedLine: string | null;
  onPick: (line: string) => void;
};

/**
 * Bottom strip in Rush Order mode — a card per candidate line for quick
 * comparison. Clicking a card selects that recommendation (timeline + details
 * panel update).
 */
export default function ScenarioStrip({ data, selectedLine, onPick }: Props) {
  const recs = data.recommendations || {};
  const keys = Object.keys(recs).sort();
  if (!keys.length) return null;

  // Build the ordering by OEE so the strongest option comes first
  const ordered = [...keys].sort(
    (a, b) => (recs[b].predictedOee || 0) - (recs[a].predictedOee || 0),
  );

  return (
    <div className="scen-strip">
      <div className="scen-label">
        <span className="eyebrow">Candidate lines</span>
        <span className="dp-fine">
          Ranked by predicted OEE — click to select.
        </span>
      </div>
      <div className="scen-list">
        {ordered.map((k, idx) => {
          const r = recs[k];
          const isSel = selectedLine === k;
          const isBest = idx === 0;
          return (
            <button
              key={k}
              className={`scen-card ${isSel ? "sel" : ""} ${isBest ? "best" : ""} ${r.oeeGood ? "" : "neg"}`}
              onClick={() => onPick(k)}
            >
              {isBest ? <span className="scen-best">★ best for OEE</span> : null}
              <div className="scen-head">
                <span className="scen-line">{r.line}</span>
                <span className={`scen-delta ${r.oeeGood ? "good" : "bad"}`}>
                  {r.oeeDelta} OEE
                </span>
              </div>
              <div className="scen-pos">{r.position}</div>
              <div className="scen-stats">
                <span>{r.evidence.n} cases</span>
                <span>·</span>
                <span>{r.recovery.hours}h recovery</span>
                <span>·</span>
                <span>
                  {r.ordersMoved} order{r.ordersMoved === 1 ? "" : "s"} moved
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
