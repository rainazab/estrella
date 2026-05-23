"use client";
import { useState } from "react";
import type { Recommendation } from "../lib/contract";

type Props = {
  recommendations: Record<string, Recommendation>;
  onHoverMove?: (line: number, of: string) => void;
};

export default function RecoveryPanel({ recommendations, onHoverMove }: Props) {
  const [open, setOpen] = useState(false);

  const ranked = Object.entries(recommendations)
    .map(([lineKey, r]) => ({ lineKey, r }))
    .sort((a, b) => a.r.recovery.hours - b.r.recovery.hours);

  return (
    <div className={`recovery-panel ${open ? "open" : ""}`}>
      <div className="rp-toggle" onClick={() => setOpen((v) => !v)}>
        <span>
          <span className="rp-ic">↩</span> Fastest back to baseline
        </span>
        <span className="caret">▾</span>
      </div>
      <div className="rp-body">
        <p className="rp-intro">
          Options ranked by how quickly the line returns to normal production.
        </p>
        {ranked.map(({ lineKey, r }, i) => {
          const fastest = i === 0;
          const moves = r.moves || [];
          return (
            <div key={lineKey} className={`rrow ${fastest ? "fastest" : ""}`}>
              <div className="rrow-head">
                <span className="rrow-line">
                  {fastest ? <span className="rrow-star">★</span> : null}
                  {r.line}
                </span>
                <span className="rrow-hrs">
                  {r.recovery.hours}h
                  <small> to baseline</small>
                </span>
              </div>
              <div className="rrow-moves">
                <span className="rrow-lbl">moves:</span>{" "}
                {moves.length === 0 ? (
                  <span className="rmove none">no orders moved</span>
                ) : (
                  moves.slice(0, 4).map((m, j) => (
                    <span
                      key={j}
                      className="rmove"
                      onMouseEnter={() => onHoverMove?.(m.line, m.of)}
                    >
                      <span className="rmove-of">{m.of}</span> {m.shift} on L
                      {m.line}
                    </span>
                  ))
                )}
              </div>
            </div>
          );
        })}
        <p className="rp-foot">
          LineWise surfaces the moves each option entails — it does not
          re-sequence the whole plan.
        </p>
      </div>
    </div>
  );
}
