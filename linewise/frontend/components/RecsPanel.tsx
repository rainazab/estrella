"use client";
import type { Objective, Recommendation, UrgentOrder } from "../lib/contract";
import RecCard, { ObjectiveKey } from "./RecCard";
import RecoveryPanel from "./RecoveryPanel";

type Props = {
  recommendations: Record<string, Recommendation>;
  objectives: Record<string, Objective>;
  infeasibleByLine?: Record<string, string>;
  urgent: UrgentOrder;
  objective: ObjectiveKey;
  onObjectiveChange: (k: ObjectiveKey) => void;
  selectedLine: string | null; // line key like "17"
  onSelectLine: (lineKey: string) => void;
  manualLine?: string | null;
  onClearManual?: () => void;
  onBack: () => void;
  onHoverMove?: (line: number, of: string) => void;
};

const OBJECTIVE_DEFAULTS: Array<{ key: ObjectiveKey; label: string; icon: string }> = [
  { key: "oee", label: "OEE", icon: "◉" },
  { key: "time", label: "Time", icon: "◷" },
  { key: "dis", label: "Disruption", icon: "⇄" },
];

function verdictFor(
  manual: Recommendation,
  best: Recommendation,
): { verdict: "match" | "ok" | "worse"; icon: string; banner: string } {
  if (manual.line === best.line) {
    return {
      verdict: "match",
      icon: "✓",
      banner:
        "This is also LineWise's top recommendation for this objective.",
    };
  }
  const gap = (best.predictedOee - manual.predictedOee) * 100;
  if (gap < 1.0) {
    return {
      verdict: "ok",
      icon: "≈",
      banner: `A workable slot. LineWise rates ${best.line} slightly higher (+${gap.toFixed(1)} OEE).`,
    };
  }
  if (gap < 4.0) {
    return {
      verdict: "ok",
      icon: "≈",
      banner: `LineWise rates ${best.line} higher by +${gap.toFixed(1)} OEE — a changeover here costs more.`,
    };
  }
  return {
    verdict: "worse",
    icon: "⚠",
    banner: `History disagrees with this placement. LineWise's recommended slot on ${best.line} is +${gap.toFixed(1)} OEE better.`,
  };
}

export default function RecsPanel({
  recommendations,
  objectives,
  infeasibleByLine,
  urgent,
  objective,
  onObjectiveChange,
  selectedLine,
  onSelectLine,
  manualLine,
  onClearManual,
  onBack,
  onHoverMove,
}: Props) {
  const objMeta = objectives[objective];
  // Order — fall back to the natural ["14","17","19"] if objectives missing
  const order: string[] =
    objMeta?.order && objMeta.order.length > 0
      ? objMeta.order
      : Object.keys(recommendations).sort();

  const orderedRecs = order
    .map((k) => ({ k, r: recommendations[k] }))
    .filter((x): x is { k: string; r: Recommendation } => Boolean(x.r));

  const best = orderedRecs[0]?.r;
  const manualRec =
    manualLine != null ? recommendations[manualLine] ?? null : null;

  const objectiveButtons = OBJECTIVE_DEFAULTS.map((o) => {
    const meta = objectives[o.key];
    return {
      key: o.key,
      label: meta?.label ?? o.label,
      icon: meta?.icon ?? o.icon,
    };
  });

  return (
    <div className="panel-pad">
      <button className="btn-back" onClick={onBack}>
        ← back to urgent orders
      </button>

      <div className="summary">
        <div className="summary-top">
          <span className="ocode">{urgent.of}</span>
          <span className="lbl">selected order</span>
        </div>
        <div className="summary-sku">{urgent.sku}</div>
        <div className="summary-grid">
          <div>
            <b>{urgent.units.toLocaleString()}</b>units
          </div>
          <div>
            <b>{urgent.hl}</b>hl
          </div>
          <div>
            <b>{urgent.due}</b>due
          </div>
        </div>
      </div>

      <div className="pill-label">Optimise for</div>
      <div className="pills">
        {objectiveButtons.map((o) => (
          <button
            key={o.key}
            className={`pill ${objective === o.key ? "on" : ""}`}
            onClick={() => onObjectiveChange(o.key)}
          >
            <span className="pi">{o.icon}</span>
            {o.label}
          </button>
        ))}
      </div>
      <div className="pill-hint">
        LineWise ranks each line. Or drag the order onto the timeline to test a
        slot of your own.
      </div>

      <div className="recs-list">
        {orderedRecs.map(({ k, r }, idx) => (
          <RecCard
            key={k}
            rec={r}
            lineKey={k}
            isBest={idx === 0}
            objectiveLabel={objMeta?.label ?? objective.toUpperCase()}
            objectiveNote={objMeta?.notes?.[k]}
            selected={k === selectedLine}
            onClick={() => onSelectLine(k)}
          />
        ))}
      </div>

      <RecoveryPanel
        recommendations={recommendations}
        onHoverMove={onHoverMove}
      />

      {manualRec && best ? (
        <div className="manual-result">
          <div className="pill-label">Your manual placement</div>
          <div className={`verdict ${verdictFor(manualRec, best).verdict}`}>
            <span className="vi">{verdictFor(manualRec, best).icon}</span>
            <span>{verdictFor(manualRec, best).banner}</span>
          </div>
          <RecCard rec={manualRec} lineKey={manualLine!} isManual />
          <button
            className="btn btn-sm"
            style={{ marginTop: 8 }}
            onClick={onClearManual}
          >
            ← clear manual placement
          </button>
        </div>
      ) : null}

      {infeasibleByLine && Object.keys(infeasibleByLine).length > 0 ? (
        <div className="manual-result">
          <div className="pill-label">Not feasible</div>
          {Object.entries(infeasibleByLine).map(([line, reason]) => (
            <div
              key={line}
              className="verdict worse"
              style={{ marginBottom: 8 }}
            >
              <span className="vi">⚠</span>
              <span>
                <b>Line {line}:</b> {reason}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="panel-foot bordered">
        Each option is scored against historical orders with the same changeover
        type. Expand &ldquo;why this&rdquo; for the evidence behind the number.
      </div>
    </div>
  );
}
