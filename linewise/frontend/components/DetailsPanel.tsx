"use client";
import type {
  LineWiseData,
  PlanReviewRiskItem,
  Recommendation,
  Seg,
  UrgentOrder,
} from "../lib/contract";
import type { CockpitMode } from "./ModeToggle";

export type Selection =
  | { kind: "none" }
  | { kind: "risk"; line: string; item: PlanReviewRiskItem }
  | { kind: "block"; line: string; of: string; seg: Seg }
  | { kind: "rec"; line: string; rec: Recommendation }
  | { kind: "urgent"; order: UrgentOrder };

type Props = {
  mode: CockpitMode;
  data: LineWiseData;
  selection: Selection;
};

function pct(v: number | null | undefined, digits = 0): string {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}
function pts(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)} pts`;
}
function mins(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${Math.round(v)} min`;
}

export default function DetailsPanel({ mode, data, selection }: Props) {
  return (
    <aside className="details-panel">
      <PanelContent mode={mode} data={data} selection={selection} />
    </aside>
  );
}

function PanelContent({ mode, data, selection }: Props) {
  // Selection always wins regardless of mode
  if (selection.kind === "risk") {
    return <RiskDetails line={selection.line} item={selection.item} />;
  }
  if (selection.kind === "rec") {
    return <RecDetails rec={selection.rec} data={data} />;
  }
  if (selection.kind === "block") {
    return <BlockDetails line={selection.line} of={selection.of} seg={selection.seg} data={data} />;
  }
  if (selection.kind === "urgent") {
    return <UrgentDetails order={selection.order} data={data} />;
  }

  // Mode-default panels
  if (mode === "plan-review") return <PlanReviewOverview data={data} />;
  if (mode === "rush-order") return <RushOrderOverview data={data} />;
  return <EvidenceOverview data={data} />;
}

// --------------------------------------------------------------- mode defaults

function PlanReviewOverview({ data }: { data: LineWiseData }) {
  const baselines = Object.entries(data.lineBaseline || {}).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  const pr = data.planReview;
  return (
    <div className="details-stack">
      <div className="dp-eyebrow">Plan review</div>
      <div className="dp-title">Reviewing tomorrow's plan against 2025 execution</div>
      <p className="dp-desc">
        Click a risk marker on the timeline to see the historical evidence behind it.
        The markers above show transitions where the plan is about to repeat a pattern
        the lines have struggled with this year.
      </p>

      <Section title="Line baselines (production-only)">
        {baselines.map(([line, b]) => (
          <div key={line} className="dp-line-row">
            <div className="dp-line-head">
              <strong>Line {line}</strong>
              <span className="dp-chip">{(b.supports_formats || []).join(" · ")}</span>
            </div>
            <div className="dp-stat-row">
              <Stat label="Avg OEE" value={pct(b.avg_oee)} />
              <Stat label="Avg changeover" value={mins(b.avg_changeover_minutes)} />
              <Stat label="Orders" value={String(b.production_orders)} />
            </div>
          </div>
        ))}
      </Section>

      {pr ? (
        <Section title="What we found in this plan window">
          <div className="dp-stat-row">
            <Stat label="Plan health" value={`${pr.plan_health_score.toFixed(0)}/100`} />
            <Stat label="Risky" value={String(pr.total_risky)} />
            <Stat label="Cleaning-heavy" value={String(pr.total_cleaning_heavy)} />
          </div>
          <p className="dp-desc">{pr.summary}</p>
        </Section>
      ) : null}
    </div>
  );
}

function RushOrderOverview({ data }: { data: LineWiseData }) {
  return (
    <div className="details-stack">
      <div className="dp-eyebrow">Rush order</div>
      <div className="dp-title">Pick an urgent OF, drop it on a line</div>
      <p className="dp-desc">
        The cockpit will simulate the insertion: which downstream orders shift, what the
        expected OEE is versus the naive plan, and what historical analogues say about
        the changeover.
      </p>
      <Section title="Pending urgent orders">
        {(data.urgentOrders || []).map((o) => (
          <div key={o.of} className={`urgent-row ${o.status}`}>
            <div className="urgent-row-top">
              <span className="urgent-of">{o.of}</span>
              <span className={`urgent-tag tag-${o.status === "urgent" ? "urgent" : "queued"}`}>
                {o.status}
              </span>
            </div>
            <div className="urgent-sku">{o.sku}</div>
            <div className="urgent-meta">
              <span>{o.volume_hl} HL</span>
              <span>·</span>
              <span>{o.format_key ?? "—"}</span>
              <span>·</span>
              <span>due {o.due}</span>
            </div>
          </div>
        ))}
      </Section>
      <Section title="Hard line constraints">
        <ul className="dp-list">
          <li>Line 14 — 1/2 (50cl) · 1/3 (33cl)</li>
          <li>Line 17 — 1/3 (33cl) only</li>
          <li>Line 19 — 1/2 · 1/3 · 2/5 (44cl)</li>
        </ul>
      </Section>
    </div>
  );
}

function EvidenceOverview({ data }: { data: LineWiseData }) {
  const yc = data.yearCompare?.["2025"] || {};
  const months = Object.keys(yc).sort();
  return (
    <div className="details-stack">
      <div className="dp-eyebrow">Evidence</div>
      <div className="dp-title">Click any block to see its analogues</div>
      <p className="dp-desc">
        Every recommendation in LineWise is grounded in real 2025 orders. The data
        spans {data.metadata?.master_rows ?? "—"} line-time blocks across lines 14, 17
        and 19.
      </p>
      <Section title="Monthly OEE — 2025">
        <table className="dp-table">
          <thead>
            <tr><th>Month</th><th>L14</th><th>L17</th><th>L19</th></tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m}>
                <td>{m}</td>
                <td>{pct(yc[m]?.["14"])}</td>
                <td>{pct(yc[m]?.["17"])}</td>
                <td>{pct(yc[m]?.["19"])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

// --------------------------------------------------------------- selection details

function RiskDetails({ line, item }: { line: string; item: PlanReviewRiskItem }) {
  return (
    <div className="details-stack">
      <div className="dp-eyebrow">Risk marker · Line {line}</div>
      <div className="dp-title">
        {item.previous_of} → {item.current_of}
      </div>
      <p className="dp-desc">{item.risk_reasons[0]}</p>

      <Section title="Why this transition is risky">
        <ul className="dp-list">
          {item.risk_reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </Section>

      <Section title="Historical benchmark">
        <div className="dp-stat-row">
          <Stat label="Transition mean OEE" value={pct(item.line_transition_benchmark_oee)} />
          <Stat label="Line baseline" value={pct(item.line_baseline_oee)} />
          <Stat label="OEE damage" value={pts(item.oee_damage_pts)} tone={item.oee_damage_pts != null && item.oee_damage_pts < -3 ? "bad" : "warn"} />
        </div>
        <div className="dp-stat-row">
          <Stat label="Cases" value={String(item.cases)} />
          <Stat label="Type" value={item.transition_type} />
          <Stat label="Risk level" value={item.risk_level} tone={item.risk_level === "high" ? "bad" : item.risk_level === "med" ? "warn" : "default"} />
        </div>
      </Section>

      <Section title="Cleaning / changeover burden">
        <div className="dp-stat-row">
          <Stat label="CF theoretical" value={mins(item.cf_theoretical_minutes)} />
          <Stat label="Actual avg" value={mins(item.mean_actual_changeover_minutes)} />
          <Stat label="Limpieza avg" value={mins(item.mean_limpieza_minutes)} />
        </div>
        <div className="dp-stat-row">
          <Stat label="PNP avg" value={mins(item.mean_pnp_minutes)} />
        </div>
      </Section>
    </div>
  );
}

function BlockDetails({
  line,
  of,
  seg,
  data,
}: {
  line: string;
  of: string;
  seg: Seg;
  data: LineWiseData;
}) {
  const baseline = data.lineBaseline?.[line];
  const kind = (seg.kind as string) || "production";
  const isNonProduction = kind === "clean" || kind === "maint";

  return (
    <div className="details-stack">
      <div className="dp-eyebrow">Block · Line {line}</div>
      <div className="dp-title">{of}</div>
      {isNonProduction ? (
        <>
          <p className="dp-desc">
            This is a {kind === "clean" ? "cleaning / CIP" : "maintenance"} block —
            it doesn't enter OEE statistics. The timeline shows it so the planner sees
            the full picture.
          </p>
          <Section title="Block">
            <div className="dp-stat-row">
              <Stat label="Kind" value={kind === "clean" ? "Cleaning / CIP" : "Maintenance"} />
              <Stat label="Width" value={`${(seg.w * 24).toFixed(0)}h`} />
            </div>
          </Section>
        </>
      ) : (
        <>
          {(seg as any).sku ? (
            <div className="dp-desc">{(seg as any).sku}</div>
          ) : null}
          <Section title="This OF">
            <div className="dp-stat-row">
              <Stat label="OEE" value={pct(seg.oee)} />
              <Stat label="Volume" value={(seg as any).vol ? `${(seg as any).vol} HL` : "—"} />
              <Stat label="Width" value={`${(seg.w * 24).toFixed(1)}h`} />
            </div>
          </Section>
          {baseline ? (
            <Section title="Vs. line baseline">
              <div className="dp-stat-row">
                <Stat label="Line avg OEE" value={pct(baseline.avg_oee)} />
                <Stat
                  label="This OF vs baseline"
                  value={
                    seg.oee != null && baseline.avg_oee != null
                      ? pts((seg.oee - baseline.avg_oee) * 100)
                      : "—"
                  }
                  tone={
                    seg.oee != null && baseline.avg_oee != null
                      ? seg.oee >= baseline.avg_oee
                        ? "good"
                        : "warn"
                      : "default"
                  }
                />
                <Stat label="Line OFs" value={String(baseline.production_orders)} />
              </div>
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

function RecDetails({ rec, data }: { rec: Recommendation; data: LineWiseData }) {
  const ev = rec.evidence;
  const lineKey = String(rec.line.match(/\d+/)?.[0] ?? "");
  const baseline = data.lineBaseline?.[lineKey];
  return (
    <div className="details-stack">
      <div className="dp-eyebrow">Recommendation</div>
      <div className="dp-title">{rec.line} {rec.position}</div>
      <div className="dp-rec-decision">
        <span className={`dp-pill ${rec.oeeGood ? "good" : "warn"}`}>
          {(rec.decision || "ACCEPT").replace(/_/g, " ")}
        </span>
        <span className={`dp-delta ${rec.oeeGood ? "good" : "bad"}`}>{rec.oeeDelta} OEE</span>
        <span className="dp-vs">vs naive</span>
      </div>

      {ev.reason ? (
        <p
          className="dp-reason"
          dangerouslySetInnerHTML={{ __html: ev.reason }}
        />
      ) : null}

      <Section title="Historical benchmark">
        <div className="dp-stat-row">
          <Stat label="Analogue mean" value={ev.analogueMean} tone="good" />
          <Stat label="Naive slot mean" value={ev.naiveMean} tone="warn" />
          <Stat label="Gain" value={ev.gain} tone={rec.oeeGood ? "good" : "warn"} />
        </div>
        <div className="dp-stat-row">
          <Stat label="Line baseline" value={pct(baseline?.avg_oee)} />
          <Stat label="Real cases" value={String(ev.n)} />
          <Stat label="Scope" value={(ev as any).scope || "—"} />
        </div>
      </Section>

      <Section title="Cleaning / changeover burden">
        <div className="dp-stat-row">
          <Stat label="CF theoretical" value={mins((ev as any).cfTheoreticalMinutes)} />
          <Stat label="Recovery (modelled)" value={`${rec.recovery.hours}h`} />
          <Stat label="Orders moved" value={String(rec.ordersMoved)} />
        </div>
        <p className="dp-fine">{rec.recovery.note}</p>
      </Section>

      <Section title="Real 2025 analogues">
        {ev.analogues && ev.analogues.length > 0 ? (
          <table className="dp-table">
            <thead>
              <tr><th>OF</th><th>Line</th><th>Date</th><th>Type</th><th>OEE</th></tr>
            </thead>
            <tbody>
              {ev.analogues.slice(0, 6).map((a, i) => (
                <tr key={i}>
                  <td className="mono">{a.of}</td>
                  <td>L{a.line}</td>
                  <td>{a.date}</td>
                  <td>{a.type}</td>
                  <td><strong>{a.oee}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="dp-desc">No matching analogues — falling back to line baseline.</div>
        )}
      </Section>

      {rec.moves && rec.moves.length > 0 ? (
        <Section title="What moves">
          <ul className="dp-list">
            {rec.moves.map((m, i) => (
              <li key={i}>
                <span className="mono">{m.of}</span> on Line {m.line} {m.shift}
                <span className="dp-fine"> — {m.why}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="What this estimate cannot see">
        <ul className="dp-list dp-fine">
          {(ev.limitations || []).map((l, i) => (<li key={i}>{l}</li>))}
        </ul>
      </Section>
    </div>
  );
}

function UrgentDetails({ order, data }: { order: UrgentOrder; data: LineWiseData }) {
  const rec = data.recommendations?.[String(data.metadata?.naive_line ?? "")];
  return (
    <div className="details-stack">
      <div className="dp-eyebrow">Selected urgent order</div>
      <div className="dp-title">{order.of}</div>
      <p className="dp-desc">{order.sku}</p>
      <Section title="Order">
        <div className="dp-stat-row">
          <Stat label="Volume" value={`${order.hl} HL`} />
          <Stat label="Format" value={order.format_key ?? "—"} />
          <Stat label="Due" value={order.due} />
        </div>
      </Section>
      <Section title="Drop on a line to evaluate">
        <p className="dp-desc">
          Drag the urgent card onto Line 14, 17 or 19. The line will accept the drop only if
          it physically supports this format. Drop on a valid line to see the predicted OEE
          gain, what moves downstream, and which 2025 analogues back the estimate.
        </p>
        {rec ? (
          <p className="dp-fine">
            Naive baseline: {rec.line} {rec.position} (OEE {rec.evidence.naiveMean}).
          </p>
        ) : null}
      </Section>
    </div>
  );
}

// --------------------------------------------------------------- atoms

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="dp-section">
      <div className="dp-h">{title}</div>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  return (
    <div className={`dp-stat dp-${tone}`}>
      <div className="dp-stat-l">{label}</div>
      <div className="dp-stat-v">{value}</div>
    </div>
  );
}
