"use client";
import { useEffect, useMemo, useRef } from "react";
import type {
  Ghost,
  LineBaseline,
  NaiveBand,
  PlanReviewRiskItem,
  Seg,
} from "../lib/contract";

export type ZoomKey = "day" | "week" | "month";

export type ZoomPreset = {
  dayW: number;
  back: number;
  ahead: number;
  label: string;
};

export const ZOOM: Record<ZoomKey, ZoomPreset> = {
  day: { dayW: 124, back: 7, ahead: 14, label: "Day" },
  week: { dayW: 54, back: 14, ahead: 28, label: "Week" },
  month: { dayW: 22, back: 30, ahead: 60, label: "Month" },
};

type CalDay = {
  label: string;
  dd: string;
  zone: "past" | "today" | "future";
  dow: number;
};

function buildCalendar(zoom: ZoomKey): CalDay[] {
  const z = ZOOM[zoom];
  const wk = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: CalDay[] = [];
  for (let i = -z.back; i <= z.ahead; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    out.push({
      label: wk[d.getDay()],
      dd: `${d.getDate()} ${mon[d.getMonth()]}`,
      zone: i < 0 ? "past" : i === 0 ? "today" : "future",
      dow: d.getDay(),
    });
  }
  return out;
}

function bandOf(oee: number): "hi" | "mid" | "lo" {
  return oee >= 0.56 ? "hi" : oee >= 0.52 ? "mid" : "lo";
}

export type DropEligibility = {
  /** When true, the line accepts the dragged urgent OF. */
  eligible: boolean;
  /** Reason shown in the drop hint when ineligible. */
  reason?: string;
};

type Props = {
  zoom: ZoomKey;
  basePlan: Record<string, Seg[]>;
  executedHistory: Record<string, Seg[]>;
  proposedPlan?: Record<string, Seg[]> | null;
  ghosts?: Record<string, Ghost[]> | null;
  naiveBand?: NaiveBand | null;
  showNaive?: boolean;
  recovery?: { line: string; start: number; w: number; hours: number } | null;
  /** Per-line eligibility for the drop hint. Required when showDrop is true. */
  eligibility?: Record<string, DropEligibility>;
  showDrop?: boolean;
  onDropOnLine?: (line: number) => void;
  /** Optional risk markers (Plan Review mode). */
  riskByLine?: Record<string, PlanReviewRiskItem[]> | null;
  /** Format chip per line, e.g. {14: ["1/2","1/3"], 17: ["1/3"], 19: ["1/2","1/3","2/5"]} */
  lineBaseline?: Record<string, LineBaseline> | null;
  /** Block selection callback — clicking a block returns its OF + line. */
  onSelectBlock?: (line: string, of: string) => void;
  selectedOf?: string | null;
  /** Risk-marker click handler (Plan Review). */
  onSelectRisk?: (line: string, marker: PlanReviewRiskItem) => void;
};

/**
 * Gantt-style timeline for Lines 14 / 17 / 19.
 *
 * Coordinate convention:
 *   * canvas spans `back + 1 + ahead` days, day 0 = today
 *   * today divider sits at PLAN_OFFSET * DAY_W
 *   * executed segs use positive offsets in [0, back]
 *   * plan segs use offsets relative to today
 */
export default function Timeline({
  zoom,
  basePlan,
  executedHistory,
  proposedPlan = null,
  ghosts = null,
  naiveBand = null,
  showNaive = false,
  recovery = null,
  eligibility = undefined,
  showDrop = false,
  onDropOnLine,
  riskByLine = null,
  lineBaseline = null,
  onSelectBlock,
  selectedOf = null,
  onSelectRisk,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cal = useMemo(() => buildCalendar(zoom), [zoom]);
  const dayW = ZOOM[zoom].dayW;
  const daysBack = ZOOM[zoom].back;
  const total = cal.length;
  const trackW = total * dayW;
  const planOffset = daysBack;
  const todayX = planOffset * dayW;
  const compact = zoom !== "day";

  useEffect(() => {
    const sc = scrollRef.current?.querySelector(".tl-scroll") as HTMLElement | null;
    if (sc) sc.scrollLeft = Math.max(0, (planOffset - 1.5) * dayW);
  }, [zoom, planOffset, dayW]);

  function planSegsFor(line: string): Seg[] {
    if (proposedPlan && proposedPlan[line]) return proposedPlan[line];
    return basePlan[line] || [];
  }

  function formatChip(line: string): string {
    const fmt = lineBaseline?.[line]?.supports_formats;
    if (!fmt || !fmt.length) return "";
    return fmt.join(" · ");
  }

  return (
    <div ref={scrollRef}>
      <div className="tl-scroll">
        <div
          className="tl-inner"
          style={
            {
              ["--day-w" as any]: `${dayW}px`,
              ["--track-w" as any]: `${trackW}px`,
            } as React.CSSProperties
          }
        >
          {/* axis */}
          <div className="tl-axis">
            {cal.map((d, i) => {
              const showLabel = !compact || d.zone === "today" || d.dow === 1;
              return (
                <div key={i} className={`day zone-${d.zone}`}>
                  {showLabel ? (
                    <>
                      <b>{compact ? d.dd : d.label}</b>
                      {compact ? null : <span className="dd">{d.dd}</span>}
                    </>
                  ) : null}
                  {d.zone === "today" ? <span className="today-pin">today</span> : null}
                </div>
              );
            })}
          </div>

          {/* line rows */}
          {["14", "17", "19"].map((line) => {
            const executedSegs = executedHistory[line] || [];
            const planSegs = planSegsFor(line);
            const lineGhosts = (ghosts && ghosts[line]) || [];
            const lineRisks = (riskByLine && riskByLine[line]) || [];
            const eligibilityInfo = eligibility?.[line];
            const elig = eligibilityInfo?.eligible ?? true;
            return (
              <div key={line} className="tl-row">
                <div className="tl-linelbl">
                  <span className="ln">{line}</span>
                  <span className="lc">CF Prat</span>
                  {formatChip(line) ? (
                    <span className="line-fmt">{formatChip(line)}</span>
                  ) : null}
                </div>
                <div
                  className={`tl-track ${showDrop && !elig ? "ineligible" : ""}`}
                  data-line={line}
                  onDragOver={(e) => {
                    if (!showDrop) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = elig ? "move" : "none";
                    (e.currentTarget.querySelector(".drop-hint") as HTMLElement | null)?.classList.add("over");
                  }}
                  onDragLeave={(e) => {
                    if (!showDrop) return;
                    (e.currentTarget.querySelector(".drop-hint") as HTMLElement | null)?.classList.remove("over");
                  }}
                  onDrop={(e) => {
                    if (!showDrop || !onDropOnLine) return;
                    e.preventDefault();
                    if (!elig) return; // block invalid drop silently — the hint already says why
                    onDropOnLine(parseInt(line, 10));
                  }}
                >
                  <div className="past-zone" style={{ width: planOffset * dayW }} />
                  <div className="today-line" style={{ left: todayX }} />

                  {showNaive && naiveBand && naiveBand.line === line ? (
                    <div
                      className="naive-band show"
                      style={{
                        left: (naiveBand.start + planOffset) * dayW,
                        width: naiveBand.w * dayW,
                      }}
                    >
                      <span>naive slot</span>
                    </div>
                  ) : null}

                  {/* ghosts */}
                  {lineGhosts.map((g, i) => (
                    <div
                      key={`ghost-${i}`}
                      className="ghost"
                      style={{ left: (g.start + planOffset) * dayW, width: g.w * dayW }}
                    >
                      <span>was here</span>
                    </div>
                  ))}

                  {/* recovery zone */}
                  {recovery && recovery.line === line ? (
                    <>
                      <div
                        className="recovery"
                        style={{
                          left: (recovery.start + planOffset) * dayW,
                          width: recovery.w * dayW,
                        }}
                      >
                        <span className="rc-name">line recovering</span>
                        <span className="rc-sub">~{recovery.hours}h to baseline</span>
                      </div>
                      <div
                        className="baseline-mark"
                        style={{ left: (recovery.start + recovery.w + planOffset) * dayW }}
                      />
                    </>
                  ) : null}

                  {/* executed segments */}
                  {executedSegs.map((s, i) => {
                    const x = s.start * dayW;
                    const wpx = Math.max(2, s.w * dayW);
                    return (
                      <SegmentEl
                        key={`exec-${i}`}
                        seg={{ ...s, kind: "past" } as Seg}
                        x={x}
                        wpx={wpx}
                        compact={compact}
                        selected={selectedOf === s.of}
                        onClick={onSelectBlock ? () => onSelectBlock(line, s.of) : undefined}
                      />
                    );
                  })}

                  {/* plan segments */}
                  {planSegs.map((s, i) => {
                    const x = (s.start + planOffset) * dayW;
                    const wpx = Math.max(2, s.w * dayW);
                    return (
                      <SegmentEl
                        key={`plan-${line}-${i}`}
                        seg={s}
                        x={x}
                        wpx={wpx}
                        compact={compact}
                        selected={selectedOf === s.of}
                        onClick={onSelectBlock ? () => onSelectBlock(line, s.of) : undefined}
                      />
                    );
                  })}

                  {/* risk markers (Plan Review) — sit on top of segments, clickable */}
                  {lineRisks.map((r, i) => (
                    <button
                      key={`risk-${i}`}
                      className={`risk-marker rl-${r.risk_level}`}
                      style={{
                        left: (r.marker_start + planOffset) * dayW - 1,
                      }}
                      title={r.risk_reasons[0] || `Risk: ${r.risk_level}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectRisk?.(line, r);
                      }}
                    >
                      <span className="rm-ico">⚠</span>
                    </button>
                  ))}

                  {/* drop hint */}
                  {showDrop ? (
                    <div
                      className={`drop-hint ${elig ? "armed eligible" : "ineligible"}`}
                      style={{
                        left: (planOffset + 0.2) * dayW,
                        width: (total - planOffset - 0.4) * dayW,
                      }}
                    >
                      {elig
                        ? `drop here to test Line ${line}`
                        : eligibilityInfo?.reason ?? `Line ${line} cannot run this format`}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SegmentEl({
  seg,
  x,
  wpx,
  compact,
  selected,
  onClick,
}: {
  seg: Seg;
  x: number;
  wpx: number;
  compact: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const kind = (seg.kind as string) || "planned";
  const isNonProduction = kind === "clean" || kind === "maint";
  const hasOee = typeof seg.oee === "number" && !isNaN(seg.oee);
  const band = isNonProduction || !hasOee ? "" : bandOf(seg.oee as number);

  const flag =
    kind === "ins" ? (
      <span className="sg-flag new">NEW</span>
    ) : kind === "shift" ? (
      <span className="sg-flag moved">MOVED</span>
    ) : null;
  const role =
    kind === "ins"
      ? "urgent insertion"
      : kind === "shift"
      ? "shifted"
      : kind === "past"
      ? "executed"
      : kind === "anchor"
      ? "anchor order"
      : kind === "clean"
      ? "cleaning / CIP"
      : kind === "maint"
      ? "maintenance window"
      : "planned order";

  const cls = `seg ${band} ${kind} ${compact ? "compact" : ""} ${selected ? "selected" : ""}`.replace(/\s+/g, " ");

  if (compact) {
    return (
      <button
        type="button"
        className={cls}
        style={{ left: x, width: wpx }}
        onClick={onClick}
        title={isNonProduction ? `${seg.of} · ${role}` : `${seg.of} · OEE ${(seg.oee as number).toFixed(2)}`}
      >
        {flag}
        <span className="sg-name">{isNonProduction ? role : seg.of}</span>
        {hasOee && !isNonProduction ? (
          <span className="sg-oee">
            <span className="dot" />
            {(seg.oee as number).toFixed(2)}
          </span>
        ) : null}
      </button>
    );
  }
  return (
    <button type="button" className={cls} style={{ left: x, width: wpx }} onClick={onClick}>
      {flag}
      <span className="sg-name">{seg.of}</span>
      <span className="sg-role">{role}</span>
      {hasOee && !isNonProduction ? (
        <span className="sg-oee">
          <span className="dot" />
          OEE {(seg.oee as number).toFixed(2)}
        </span>
      ) : null}
    </button>
  );
}
