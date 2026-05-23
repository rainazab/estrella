"use client";
import type { Recommendation, UrgentOrder } from "../lib/contract";

type Props = {
  rec: Recommendation;
  urgent: UrgentOrder;
  isFastest: boolean;
};

export default function ImpactSummary({ rec, urgent, isFastest }: Props) {
  const positive = rec.oeeGood;
  const moves = rec.moves || [];
  const moveText = moves.length
    ? moves.map((m) => `${m.of} (${m.shift})`).join(", ")
    : "nothing else moves";

  return (
    <div className={`impact ${positive ? "pos" : "neg"}`}>
      <div className="impact-lead">
        <span className="impact-eyebrow">Impact of this choice</span>
        <div className="impact-headline">
          <span className="impact-delta">
            {rec.oeeDelta}
            <span className="iu"> OEE</span>
          </span>
          <span className="impact-vs">vs. the naive plan</span>
        </div>
      </div>
      <div className="impact-grid">
        <div className="ic-cell">
          <span className="ic-lbl">Back to baseline</span>
          <span className="ic-val">
            {rec.recovery.hours}h
            {isFastest ? <span className="ic-tag good"> fastest</span> : null}
          </span>
        </div>
        <div className="ic-cell">
          <span className="ic-lbl">Deadline</span>
          <span className="ic-val">{rec.deadline}</span>
        </div>
        <div className="ic-cell">
          <span className="ic-lbl">Production placed</span>
          <span className="ic-val">{urgent.hl} hl</span>
        </div>
        <div className="ic-cell">
          <span className="ic-lbl">Plan disruption</span>
          <span className="ic-val">
            {rec.ordersMoved} order{rec.ordersMoved === 1 ? "" : "s"} moved
          </span>
        </div>
      </div>
      <div className="impact-foot">
        {positive ? (
          <>
            Choosing {rec.line} recovers <b>{rec.oeeDelta} OEE</b> over the
            naive slot — moves {moveText}.
          </>
        ) : (
          <>
            {rec.line} predicts a net <b>{rec.oeeDelta} OEE</b> versus the naive
            plan — consider the recommended option instead.
          </>
        )}
      </div>
    </div>
  );
}
