"use client";
import { useEffect, useState } from "react";

const STEPS = [
  "Line 14 — changeover analogues",
  "Line 17 — changeover analogues",
  "Line 19 — changeover analogues",
  "Netting out cleaning & downtime",
];

export default function CalculatingStage() {
  const [done, setDone] = useState<number>(0);

  useEffect(() => {
    const timers: number[] = [];
    STEPS.forEach((_, i) => {
      timers.push(
        window.setTimeout(() => setDone(i + 1), 260 * (i + 1)),
      );
    });
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="stage-pad">
      <div className="stage-head">
        <div>
          <div className="stage-title">Evaluating insertion options</div>
          <div className="stage-sub">
            Matching the urgent order against executed history
          </div>
        </div>
        <span className="stage-tag">working…</span>
      </div>

      <div className="center-state">
        <div className="scanbox">
          {STEPS.map((s, i) => (
            <div key={i} className="scanline">
              <span>{s}</span>
              {i < done ? (
                <span className="done">✓</span>
              ) : (
                <span className="pend">…</span>
              )}
            </div>
          ))}
          <div className="progress">
            <div
              className="fill"
              style={{ width: `${(done / STEPS.length) * 100}%` }}
            />
          </div>
        </div>
        <div className="small">
          Scanning executed orders across three lines
        </div>
      </div>
    </div>
  );
}
