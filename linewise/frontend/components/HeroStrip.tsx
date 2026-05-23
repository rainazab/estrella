"use client";
import type { CockpitMode } from "./ModeToggle";
import type { LineWiseData, Recommendation } from "../lib/contract";

type Props = {
  mode: CockpitMode;
  data: LineWiseData;
  /** When in Rush Order mode with a placement, this is the recommended candidate. */
  rec?: Recommendation | null;
};

function cls(n: number, good: number, mid: number): "good" | "warn" | "bad" {
  if (n >= good) return "good";
  if (n >= mid) return "warn";
  return "bad";
}

function pct(v: number | null | undefined, digits = 0): string {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

/**
 * Four headline cards above the timeline. Content adapts to the mode:
 *
 *   plan-review:  Plan Health · Top line · Risky transitions · Cleaning burden
 *   rush-order:   OEE vs Benchmark · Capacity protected · Cleaning risk · Decision
 *   evidence:     Lines scanned · Transitions analyzed · OEE capped · Months covered
 */
export default function HeroStrip({ mode, data, rec }: Props) {
  if (mode === "rush-order" && rec) {
    const benchmarkOee = rec.evidence.analogueMean;
    const naiveOee = rec.evidence.naiveMean;
    const gain = rec.evidence.gain;
    const recoveryHrs = rec.recovery.hours;
    const movedCount = rec.ordersMoved;
    return (
      <div className="hero-strip">
        <HeroCard
          label="OEE vs Historical Benchmark"
          value={`${benchmarkOee}`}
          sub={`Naive slot: ${naiveOee} · Gain: ${gain} pts`}
          tone={rec.oeeGood ? "good" : "bad"}
        />
        <HeroCard
          label="Capacity Protected"
          value={`${data.lineBaseline[String(rec.line.match(/\d+/)?.[0] ?? "")]?.production_orders ?? "—"} historical OFs`}
          sub={`Line baseline: ${pct(data.lineBaseline[String(rec.line.match(/\d+/)?.[0] ?? "")]?.avg_oee)}`}
          tone="default"
        />
        <HeroCard
          label="Recovery (modelled)"
          value={`${recoveryHrs}h to baseline`}
          sub="After the urgent insertion"
          tone={recoveryHrs <= 8 ? "good" : recoveryHrs <= 24 ? "warn" : "bad"}
        />
        <HeroCard
          label="Decision"
          value={(rec.decision || "ACCEPT").replace(/_/g, " ")}
          sub={`Moves: ${movedCount} order${movedCount === 1 ? "" : "s"} · Evidence: ${rec.evidence.n} real cases`}
          tone={rec.oeeGood ? "good" : "warn"}
        />
      </div>
    );
  }

  if (mode === "evidence") {
    const meta = data.metadata || {};
    const months = Object.keys((data.yearCompare["2025"] || {})).length;
    return (
      <div className="hero-strip">
        <HeroCard
          label="Master rows"
          value={String(meta.master_rows ?? "—")}
          sub={`Production: ${(meta as any).production_runs ?? "—"}`}
          tone="default"
        />
        <HeroCard
          label="Transitions analysed"
          value={String(meta.transitions_analyzed ?? "—")}
          sub="Production → production only"
          tone="default"
        />
        <HeroCard
          label="OEE capped"
          value={String((meta as any).oee_capped ?? "—")}
          sub="Rows where OEE > 1.0 was clipped"
          tone="default"
        />
        <HeroCard
          label="Months of evidence"
          value={`${months} months`}
          sub="2025 execution history"
          tone="default"
        />
      </div>
    );
  }

  // Plan Review (default)
  const pr = data.planReview;
  const health = pr?.plan_health_score ?? null;
  const baselineEntries = Object.entries(data.lineBaseline || {});
  const bestLine = baselineEntries.length
    ? baselineEntries.sort((a, b) => (b[1].avg_oee ?? 0) - (a[1].avg_oee ?? 0))[0]
    : null;
  const worstLine = baselineEntries.length
    ? baselineEntries.sort((a, b) => (a[1].avg_oee ?? 0) - (b[1].avg_oee ?? 0))[0]
    : null;
  return (
    <div className="hero-strip">
      <HeroCard
        label="Plan Health"
        value={health != null ? `${health.toFixed(0)} / 100` : "—"}
        sub={pr?.summary ?? "Reviewing forward plan against 2025 execution history"}
        tone={health == null ? "default" : cls(health, 75, 50)}
      />
      <HeroCard
        label="Risky transitions"
        value={pr?.total_risky != null ? String(pr.total_risky) : "—"}
        sub={
          pr?.total_cleaning_heavy
            ? `${pr.total_cleaning_heavy} are cleaning-heavy`
            : "Click a red marker on the timeline"
        }
        tone={(pr?.total_risky ?? 0) > 4 ? "bad" : (pr?.total_risky ?? 0) > 0 ? "warn" : "good"}
      />
      <HeroCard
        label="Best line (history)"
        value={bestLine ? `Line ${bestLine[0]} · ${pct(bestLine[1].avg_oee)}` : "—"}
        sub={
          bestLine
            ? `${bestLine[1].production_orders} OFs · supports ${(bestLine[1].supports_formats || []).join(", ")}`
            : "Baseline not available"
        }
        tone="good"
      />
      <HeroCard
        label="Worst line (history)"
        value={worstLine ? `Line ${worstLine[0]} · ${pct(worstLine[1].avg_oee)}` : "—"}
        sub={
          worstLine
            ? `${worstLine[1].production_orders} OFs · ${worstLine[1].avg_changeover_minutes ?? "—"} min avg changeover`
            : "Baseline not available"
        }
        tone="warn"
      />
    </div>
  );
}

function HeroCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  return (
    <div className={`hero-card hero-${tone}`}>
      <div className="hero-label">{label}</div>
      <div className="hero-value">{value}</div>
      <div className="hero-sub">{sub}</div>
    </div>
  );
}
