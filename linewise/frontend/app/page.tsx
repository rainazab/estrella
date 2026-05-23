"use client";
import { useEffect, useMemo, useState } from "react";
import DetailsPanel, { Selection } from "../components/DetailsPanel";
import HeroStrip from "../components/HeroStrip";
import Legend from "../components/Legend";
import ModeToggle, { CockpitMode } from "../components/ModeToggle";
import ScenarioStrip from "../components/ScenarioStrip";
import Timeline, { DropEligibility, ZoomKey } from "../components/Timeline";
import UrgentOrderTray from "../components/UrgentOrderTray";
import ZoomControl from "../components/ZoomControl";
import {
  FALLBACK_DATA,
  loadData,
  type LineWiseData,
  type UrgentOrder,
} from "../lib/contract";

/**
 * The cockpit. One screen, three modes:
 *
 *   Plan Review (default)  — overview of the future plan with risk markers
 *   Rush Order             — drag an urgent OF onto a line + see the impact
 *   Evidence               — click any block to see its 2025 analogues
 *
 * Everything reads from `data.json`. No runtime backend dependency.
 */
export default function CockpitPage() {
  const [data, setData] = useState<LineWiseData>(FALLBACK_DATA);
  const [loaded, setLoaded] = useState(false);

  const [mode, setMode] = useState<CockpitMode>("plan-review");
  const [zoom, setZoom] = useState<ZoomKey>("day");

  // Selection drives the right-side details panel
  const [selection, setSelection] = useState<Selection>({ kind: "none" });

  // Rush Order state
  const [urgent, setUrgent] = useState<UrgentOrder | null>(null);
  const [placedLine, setPlacedLine] = useState<string | null>(null);
  const [showNaive, setShowNaive] = useState(false);

  useEffect(() => {
    loadData()
      .then((d) => {
        setData(d);
        // Pre-select the first urgent order so the Rush Order tray feels live
        const firstUrgent = d.urgentOrders?.find((o) => o.status === "urgent");
        if (firstUrgent) setUrgent(firstUrgent);
      })
      .finally(() => setLoaded(true));
  }, []);

  // Reset selection when switching modes
  useEffect(() => {
    setSelection({ kind: "none" });
    if (mode !== "rush-order") setPlacedLine(null);
  }, [mode]);

  // ---------------- derived: rush-order recommendation
  const recForPlacement = useMemo(() => {
    if (!placedLine) return null;
    return data.recommendations?.[placedLine] ?? null;
  }, [data, placedLine]);

  // ---------------- per-line eligibility for the dragged urgent
  const eligibility: Record<string, DropEligibility> = useMemo(() => {
    if (!urgent) return {};
    const out: Record<string, DropEligibility> = {};
    for (const line of ["14", "17", "19"]) {
      const fmt = urgent.format_key;
      const supported = data.lineBaseline?.[line]?.supports_formats || [];
      if (!fmt) {
        out[line] = { eligible: true };
      } else if (supported.includes(fmt)) {
        out[line] = { eligible: true };
      } else {
        out[line] = {
          eligible: false,
          reason: `Line ${line} only produces ${supported.join(" / ") || "no can format"}.`,
        };
      }
    }
    return out;
  }, [urgent, data.lineBaseline]);

  // ---------------- handlers
  function handleDropOnLine(line: number) {
    const key = String(line);
    if (!eligibility[key]?.eligible) return; // belt and braces
    if (!data.recommendations?.[key]) return;
    setPlacedLine(key);
    setSelection({ kind: "rec", line: key, rec: data.recommendations[key] });
  }

  function handleSelectBlock(line: string, of: string) {
    // Find the seg in either executed or plan
    const planSeg = (data.basePlan?.[line] || []).find((s) => s.of === of);
    const execSeg = (data.executedHistory?.[line] || []).find((s) => s.of === of);
    const seg = planSeg || execSeg;
    if (!seg) return;
    setSelection({ kind: "block", line, of, seg });
  }

  function handleSelectRisk(line: string, item: any) {
    setSelection({ kind: "risk", line, item });
  }

  function handlePickUrgent(o: UrgentOrder) {
    setUrgent(o);
    setPlacedLine(null);
    setSelection({ kind: "urgent", order: o });
  }

  function handlePickScenarioLine(line: string) {
    setPlacedLine(line);
    const r = data.recommendations?.[line];
    if (r) setSelection({ kind: "rec", line, rec: r });
  }

  // ---------------- composed view inputs
  const status = (() => {
    const meta = data.metadata;
    if (!loaded) return "Loading 2025 execution history…";
    const rows = meta?.master_rows ?? "—";
    return `Data: 2025 execution history · ${rows} blocks · Lines 14 / 17 / 19`;
  })();

  const fallbackBanner =
    loaded && data.metadata?.using_fallback_data ? (
      <div className="fallback-banner">
        Showing fallback data — run{" "}
        <code>cd backend && python -m app.export_data_json</code> to refresh
        the snapshot.
      </div>
    ) : null;

  const heroRec = mode === "rush-order" && placedLine
    ? data.recommendations?.[placedLine]
    : null;

  const showDrop = mode === "rush-order" && !!urgent;
  const proposedPlan = recForPlacement?.plan;
  const ghosts = recForPlacement?.ghosts;
  const naiveBand = recForPlacement?.naiveBand;
  const recovery = recForPlacement
    ? {
        line: recForPlacement.recovery.line,
        start: recForPlacement.recovery.start,
        w: recForPlacement.recovery.w,
        hours: recForPlacement.recovery.hours,
      }
    : null;
  const riskByLine = mode === "plan-review" ? data.planReview?.risky_by_line : null;

  // Selected OF — for highlighting on the timeline
  const selectedOf = (() => {
    if (selection.kind === "block") return selection.of;
    if (selection.kind === "risk") return selection.item.current_of;
    return null;
  })();

  return (
    <div className="cockpit">
      <div className="cockpit-head">
        <div className="cockpit-titles">
          <h1>Execution Intelligence for Production Planning</h1>
          <div className="cockpit-sub">
            LineWise turns 2025 executed history on lines 14, 17 and 19 into
            forward-looking planning intelligence — Blue Yonder makes a plan,
            LineWise checks whether it&apos;s likely to execute well.
          </div>
        </div>
        <ModeToggle mode={mode} onChange={setMode} status={status} />
      </div>

      {fallbackBanner}

      <HeroStrip mode={mode} data={data} rec={heroRec} />

      {mode === "rush-order" ? (
        <UrgentOrderTray
          orders={data.urgentOrders || []}
          selected={urgent}
          onSelect={handlePickUrgent}
        />
      ) : null}

      <div className="cockpit-main">
        <section className="cockpit-stage">
          <div className="stage-bar">
            <div className="stage-bar-left">
              {mode === "rush-order" && placedLine ? (
                <>
                  <span className="stage-title">Proposed plan · {recForPlacement?.line}</span>
                  <span className="stage-sub">
                    Urgent order {urgent?.of} inserted {recForPlacement?.position}
                  </span>
                </>
              ) : mode === "rush-order" ? (
                <>
                  <span className="stage-title">Future plan</span>
                  <span className="stage-sub">
                    Drag the selected urgent order onto a feasible line.
                  </span>
                </>
              ) : (
                <>
                  <span className="stage-title">Future plan</span>
                  <span className="stage-sub">
                    {data.planReview?.summary ?? "Lines 14 / 17 / 19 · scroll horizontally"}
                  </span>
                </>
              )}
            </div>
            <div className="stage-bar-right">
              {mode === "rush-order" && placedLine && naiveBand ? (
                <label className="naive-toggle compact">
                  <input
                    type="checkbox"
                    checked={showNaive}
                    onChange={(e) => setShowNaive(e.target.checked)}
                  />
                  Show naive
                </label>
              ) : null}
              <ZoomControl zoom={zoom} onChange={setZoom} />
            </div>
          </div>

          <Timeline
            zoom={zoom}
            basePlan={data.basePlan}
            executedHistory={data.executedHistory}
            proposedPlan={proposedPlan}
            ghosts={ghosts}
            naiveBand={naiveBand}
            showNaive={showNaive}
            recovery={recovery}
            eligibility={eligibility}
            showDrop={showDrop}
            onDropOnLine={handleDropOnLine}
            riskByLine={riskByLine}
            lineBaseline={data.lineBaseline}
            onSelectBlock={handleSelectBlock}
            selectedOf={selectedOf}
            onSelectRisk={handleSelectRisk}
          />
          <Legend showCond={mode === "rush-order"} />
        </section>

        <DetailsPanel mode={mode} data={data} selection={selection} />
      </div>

      {mode === "rush-order" ? (
        <ScenarioStrip
          data={data}
          selectedLine={placedLine}
          onPick={handlePickScenarioLine}
        />
      ) : null}
    </div>
  );
}
