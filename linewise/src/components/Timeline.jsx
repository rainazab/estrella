import { Fragment, useEffect, useRef, useState } from 'react';
import TimelineCard, { deriveFormat } from './TimelineCard.jsx';
import AggregateCard from './AggregateCard.jsx';
import InfoPopover from './InfoPopover.jsx';
import IssueBadge from './IssueBadge.jsx';
import { isLineCompatible, incompatibleReason } from '../lib/movePlan.js';

/* Timeline — three line lanes (14, 17, 19), each a horizontally-scrolling
   row of TimelineCards. Executed-history cards (faded) flow first, then a
   TODAY divider, then planned cards.

   `seg.start` and `seg.w` come from the backend in timeline.timeUnit
   (currently hours). We convert to days only for horizontal scale and
   date labels; TimelineCard still receives true hours for its duration. */

const LINES = ['14', '17', '19'];
const HOURS_PER_DAY = 24;

const FALLBACK_WIDTH_PER_DAY = { week: 124, month: 28, quarter: 14 };
const VISIBLE_DAYS = { week: 7, month: 35, quarter: 70 };
const MIN_CARD_WIDTH = { week: 168, month: 80, quarter: 36 };
const TIMELINE_HEAD_WIDTH = 156;

/* Date helpers — turn day offsets/durations into labels like "Mon 19"
   or "Mon 19 → Wed 21".
   TODAY is hardcoded to match the prototype; later this should come from
   data.today on the server payload. */
const TODAY = new Date(2026, 4, 23);
const WK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + Math.round(days));
  return d;
}

function fmtDay(d) {
  return `${WK[d.getDay()]} ${d.getDate()}`;
}

function fmtRangeDay(d) {
  return `${d.getDate()} ${MONTH[d.getMonth()]}`;
}

function isoWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const weekOne = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - weekOne) / 86400000 - 3 + ((weekOne.getDay() + 6) % 7)) / 7);
}

function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function daysSinceWeekStart(date) {
  return (date.getDay() + 6) % 7;
}

function dayRange(startOffsetDays, durationDays) {
  const startD = addDays(TODAY, startOffsetDays);
  const endD   = addDays(TODAY, startOffsetDays + durationDays);
  if (startD.toDateString() === endD.toDateString()) return fmtDay(startD);
  return `${fmtDay(startD)} → ${fmtDay(endD)}`;
}

function payloadTimeUnit(data) {
  return data?.timeline?.timeUnit === 'days' ? 'days' : 'hours';
}

function unitsToDays(value, timeUnit) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return timeUnit === 'days' ? n : n / HOURS_PER_DAY;
}

function unitsToHours(value, timeUnit) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return timeUnit === 'days' ? n * HOURS_PER_DAY : n;
}

function segStartDays(seg, timeUnit) {
  return unitsToDays(seg?.start ?? 0, timeUnit);
}

function segDurationDays(seg, timeUnit) {
  return unitsToDays(seg?.w ?? 1, timeUnit);
}

function segDurationHours(seg, timeUnit) {
  return unitsToHours(seg?.w ?? 1, timeUnit);
}

/* executedEnd — cumulative end (in days) of the last executed segment for
   a lane. Used to translate executed seg.start (canvas-relative, starting
   from the beginning of the executed window) into a day offset from today
   (negative for past runs). */
function executedEnd(executed, timeUnit) {
  if (!executed?.length) return 0;
  return Math.max(...executed.map((s) => segStartDays(s, timeUnit) + segDurationDays(s, timeUnit)));
}

function plannedEnd(seg, timeUnit) {
  return segStartDays(seg, timeUnit) + segDurationDays(seg, timeUnit);
}

function segmentWidthPx(seg, zoom, pxPerDay, timeUnit) {
  return Math.max(
    MIN_CARD_WIDTH[zoom] ?? 168,
    Math.round(segDurationDays(seg, timeUnit) * pxPerDay),
  );
}

function aggregateWidthPx(zoom, pxPerDay) {
  if (zoom === 'month') return Math.max(220, Math.round(7 * pxPerDay));
  return null;
}

export default function Timeline({
  data,
  effectivePlan = null,
  mode = 'default',
  zoom = 'week',
  rec = null,
  showNaive = false,
  onRunClick = null,
  moving = null,
  onMoveDrop = null,
  focusRun = null,
  stoppages = [],
  issues = [],
  onResumeLine = null,
}) {
  const timelineRef = useRef(null);
  const sync = useSharedScroll();
  const viewportWidth = useTimelineViewportWidth(timelineRef);
  const pxPerDay = pxPerDayForZoom(zoom, viewportWidth);
  const timeUnit = payloadTimeUnit(data);
  const execDaysByLine = mode === 'default'
    ? LINES.map((k) => executedEnd(data?.executedHistory?.[k] ?? [], timeUnit))
    : LINES.map(() => 0);
  const maxExecDays = Math.ceil(Math.max(0, ...execDaysByLine));
  const execDays = maxExecDays;
  const activePlan = effectivePlan ?? data.basePlan;
  const planHorizonDays = Math.ceil(Math.max(
    1,
    ...LINES.flatMap((k) => (activePlan?.[k] ?? []).map((seg) => plannedEnd(seg, timeUnit))),
  ));
  const todayXForMetrics = maxExecDays * pxPerDay;
  const laneMetrics = LINES.map((lineKey) => {
    const laneExecDays = mode === 'default'
      ? executedEnd(data?.executedHistory?.[lineKey] ?? [], timeUnit)
      : 0;
    const leadPadDays = Math.max(0, maxExecDays - laneExecDays);
    const executedWidth = (data?.executedHistory?.[lineKey] ?? [])
      .reduce((sum, seg) => sum + segmentWidthPx(seg, zoom, pxPerDay, timeUnit), 0);
    const planned = activePlan?.[lineKey] ?? [];
    const aggregateWidth = aggregateWidthPx(zoom, pxPerDay);
    let plannedWidth;
    if (aggregateWidth == null) {
      plannedWidth = planned.reduce((sum, seg) => sum + segmentWidthPx(seg, zoom, pxPerDay, timeUnit), 0);
    } else {
      /* Month zoom — aggregates are absolutely positioned by week start,
         not flowed sequentially. plannedWidth here is the flex-flow
         padding needed to extend scrollWidth past the rightmost absolute
         aggregate, measured from the post-executed flex cursor. */
      const weeks = buildWeekAggregates(planned, timeUnit);
      const postExec = (leadPadDays * pxPerDay) + executedWidth;
      let maxRight = postExec;
      for (const w of weeks) {
        const days = Math.round((w.weekStart - TODAY) / 86400000);
        const right = todayXForMetrics + days * pxPerDay + aggregateWidth;
        if (right > maxRight) maxRight = right;
      }
      plannedWidth = Math.max(0, maxRight - postExec);
    }
    return {
      leadPadDays,
      contentWidthPx: (leadPadDays * pxPerDay) + executedWidth + plannedWidth,
    };
  });
  const maxLaneContentWidthPx = Math.max(0, ...laneMetrics.map((m) => m.contentWidthPx));
  const orderLookup = buildOrderLookup(data);
  /* todayX — pixel x of the "now" line in scroll-content coordinates,
     shared across the axis and every lane so the NOW stripe forms one
     continuous vertical column even when executed cards on each line have
     different cumulative widths. Same formula the axis uses for its
     today bar (executedDays * pxPerDay), so lanes line up with the date
     strip above. */
  const todayX = execDays * pxPerDay;

  if (mode !== 'default') {
    if (!rec) {
      return (
        <div className="tl-placeholder">
          Timeline ({mode} mode) — choose a recommendation first.
        </div>
      );
    }

    return (
      <div className="tl" ref={timelineRef}>
        <TimelineAxis zoom={zoom} sync={sync} executedDays={execDays} pxPerDay={pxPerDay} />
        {LINES.map((lineKey, idx) => (
          <RecommendationLane
            key={lineKey}
            data={data}
            lineKey={lineKey}
            rec={rec}
            zoom={zoom}
            showNaive={showNaive}
            sync={sync}
            primary={idx === 0}
            todayX={todayX}
            pxPerDay={pxPerDay}
            timeUnit={timeUnit}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={`tl${moving ? ' tl-moving' : ''}`} ref={timelineRef}>
      <TimelineAxis zoom={zoom} sync={sync} executedDays={execDays} pxPerDay={pxPerDay} />
      {LINES.map((lineKey, idx) => {
        const planned = activePlan?.[lineKey] ?? [];
        const stoppage = stoppages.find((s) => s.line === lineKey) ?? null;
        const laneIssues = issues.filter((i) => i.line === lineKey);
        const laneMetric = laneMetrics[idx] ?? { leadPadDays: 0, contentWidthPx: 0 };
        const tailPadPx = Math.max(0, maxLaneContentWidthPx - laneMetric.contentWidthPx);
        return (
          <Lane
            key={lineKey}
            lineKey={lineKey}
            centre={data.lineCentre?.[lineKey] ?? 'CF Prat'}
            baseline={data.lineBaseline?.[lineKey]}
            formats={data.lineFormats?.[lineKey] ?? laneFormatsFromRules(data.lineRules?.[lineKey])}
            executed={data.executedHistory?.[lineKey] ?? []}
            planned={planned}
            zoom={zoom}
            sync={sync}
            primary={idx === 0}
            leadPadDays={laneMetric.leadPadDays}
            tailPadPx={tailPadPx}
            planHorizonDays={planHorizonDays}
            todayX={todayX}
            pxPerDay={pxPerDay}
            timeUnit={timeUnit}
            orderLookup={orderLookup}
            onRunClick={onRunClick}
            moving={moving}
            onMoveDrop={onMoveDrop}
            focusRun={focusRun}
            lineRules={data?.lineRules}
            stoppage={stoppage}
            issues={laneIssues}
            onResumeLine={onResumeLine}
          />
        );
      })}
    </div>
  );
}

function pxPerDayForZoom(zoom, viewportWidth) {
  const visibleDays = VISIBLE_DAYS[zoom] ?? VISIBLE_DAYS.week;
  if (!viewportWidth) return FALLBACK_WIDTH_PER_DAY[zoom] ?? FALLBACK_WIDTH_PER_DAY.week;
  return Math.max(1, viewportWidth / visibleDays);
}

function useTimelineViewportWidth(ref) {
  const [width, setWidth] = useState(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    function updateWidth() {
      setWidth(Math.max(280, el.clientWidth - TIMELINE_HEAD_WIDTH - 2));
    }

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

/* useSharedScroll — central scroll-sync controller. Lanes and the axis
   register their scroll containers and call `broadcast` whenever they
   scroll; broadcast propagates the new scrollLeft to all other members.
   The primary member's scrollLeft is the source of truth: late registrants
   sync to it on register (which closes the StrictMode timing hole where
   the primary's first broadcast fires before its siblings are registered).
   A suppress guard prevents the propagated assignments from echoing. */
function useSharedScroll() {
  const state = useRef({ members: new Set(), suppress: false, primary: null, primaryX: 0 });
  return useRef({
    register(el, { primary = false } = {}) {
      if (!el) return () => {};
      const s = state.current;
      s.members.add(el);
      if (primary) s.primary = el;
      // Pull this element to the current primary scroll, in case the
      // primary's auto-scroll already broadcast before this member mounted.
      if (s.primary && s.primary !== el && s.primaryX) {
        s.suppress = true;
        el.scrollLeft = s.primaryX;
        requestAnimationFrame(() => { s.suppress = false; });
      }
      return () => {
        s.members.delete(el);
        if (s.primary === el) { s.primary = null; s.primaryX = 0; }
      };
    },
    broadcast(source) {
      const s = state.current;
      if (s.suppress || !source) return;
      s.suppress = true;
      const x = source.scrollLeft;
      if (source === s.primary) s.primaryX = x;
      for (const other of s.members) {
        if (other !== source && other.scrollLeft !== x) other.scrollLeft = x;
      }
      requestAnimationFrame(() => { s.suppress = false; });
    },
  }).current;
}

/* TimelineAxis — date strip above the lanes. Mirrors the horizontal scroll
   of the first lane so the dates line up with the cards. */
function TimelineAxis({ zoom, sync, executedDays = 0, pxPerDay }) {
  const axisBodyRef = useRef(null);
  const RANGE_START = -Math.max(0, executedDays);
  const RANGE_END = Math.max(35, Math.ceil((VISIBLE_DAYS[zoom] ?? VISIBLE_DAYS.week) * 1.25));

  useEffect(() => sync?.register(axisBodyRef.current), [sync]);

  const weeks = [];
  for (let offset = RANGE_START; offset <= RANGE_END;) {
    const date = addDays(TODAY, offset);
    const startOfWeek = weekStart(date);
    const daysIntoWeek = Math.round((date - startOfWeek) / 86400000);
    const span = Math.min(7 - daysIntoWeek, RANGE_END - offset + 1);
    weeks.push({
      offset,
      span,
      week: isoWeekNumber(date),
      isToday: offset <= 0 && 0 < offset + span,
    });
    offset += span;
  }

  return (
    <div className="tl-axis">
      <div className="tl-axis-head" aria-hidden="true" />
      <div className="tl-axis-body" ref={axisBodyRef}>
        <div className="tl-axis-today" aria-hidden="true" style={{ left: Math.abs(RANGE_START) * pxPerDay }} />
        {weeks.map(({ offset, span, week, isToday }) => {
          return (
            <div
              key={offset}
              className={`tl-axis-day tl-axis-week${isToday ? ' is-today' : ''}`}
              style={{ width: span * pxPerDay }}
              aria-label={`${isToday ? 'Current, ' : ''}week ${week}`}
            >
              {isToday && <span className="tl-axis-dow">Current</span>}
              <span className="tl-axis-date">W{week}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecommendationLane({ data, lineKey, rec, zoom, showNaive, sync, primary = false, todayX = 0, pxPerDay, timeUnit }) {
  const proposed = rec.plan?.[lineKey] ?? [];
  const ghosts = rec.ghosts?.[lineKey] ?? [];
  const naiveHere = showNaive && rec.naiveBand?.line === lineKey ? rec.naiveBand : null;
  const recoveryHere = rec.recovery?.line === lineKey ? rec.recovery : null;
  const baseline = data.lineBaseline?.[lineKey];
  const lookup = buildOrderLookup(data);
  const bodyRef = useRef(null);
  useEffect(() => sync?.register(bodyRef.current, { primary }), [sync, primary]);
  useEffect(() => {
    if (!primary) return;
    const t = setTimeout(() => { sync?.broadcast(bodyRef.current); }, 60);
    return () => clearTimeout(t);
  }, [primary, sync, zoom]);

  return (
    <div className={`tl-lane${rec.line.endsWith(lineKey) ? ' tl-lane-recommended' : ''}`}>
      <div className="tl-lane-head">
        <span className="ln">L{lineKey}</span>
        <span className="ce">{data.lineCentre?.[lineKey] ?? 'CF Prat'}</span>
        {baseline != null && <span className="bl">Baseline {baseline.toFixed(2)}</span>}
        {(() => {
          const fmts = data.lineFormats?.[lineKey] ?? laneFormatsFromRules(data.lineRules?.[lineKey]);
          return fmts.length > 0 ? (
            <span className="tl-lane-formats" aria-label="Compatible can formats">
              {fmts.map((fmt) => (
                <span key={fmt} className="tl-lane-fmt-chip">{fmt}</span>
              ))}
            </span>
          ) : null;
        })()}
        {rec.line.endsWith(lineKey) && (
          <div className="tl-next-stop tl-rec-badge">
            <span className="ns-h">Stride</span>
            <div className="ns-row">
              <span className="ns-lbl">Recommended</span>
            </div>
            <span className="ns-when">{rec.oeeDelta} OEE</span>
          </div>
        )}
      </div>
      <div className="tl-lane-body" ref={bodyRef} onScroll={() => sync?.broadcast(bodyRef.current)}>
        <div className="tl-today" aria-label="current" style={{ left: todayX }} />
        {proposed.map((seg, index) => (
          <SegmentCard
            key={`r-${lineKey}-${seg.of ?? seg.kind}-${index}`}
            seg={hydrateSegment(seg, lookup)}
            baseline={baseline}
            state="planned"
            zoom={zoom}
            pxPerDay={pxPerDay}
            shiftFromHours={shiftHours(rec, seg, lineKey)}
            timeUnit={timeUnit}
            dateLabel={dayRange(segStartDays(seg, timeUnit), segDurationDays(seg, timeUnit))}
          />
        ))}
        {ghosts.map((seg, index) => (
          <SegmentCard
            key={`g-${lineKey}-${seg.of}-${index}`}
            seg={{ ...hydrateSegment(seg, lookup), kind: 'ghost' }}
            baseline={baseline}
            state="planned"
            zoom={zoom}
            pxPerDay={pxPerDay}
            timeUnit={timeUnit}
            dateLabel="previous slot"
          />
        ))}
        {naiveHere && (
          <div className="tl-decision-marker tl-naive-marker">
            <span>Naive slot</span>
            <b>{Math.round(unitsToHours(naiveHere.w ?? 0, timeUnit))}h exposure</b>
          </div>
        )}
        {recoveryHere && (
          <div className="tl-decision-marker tl-recovery-marker">
            <span>Recovery</span>
            <b>{recoveryHere.hours}h to baseline</b>
          </div>
        )}
      </div>
    </div>
  );
}

function buildOrderLookup(data) {
  const lookup = new Map();
  for (const order of data.urgentOrders ?? []) {
    lookup.set(order.of, {
      sku: order.sku,
      vol: order.units,
    });
  }
  for (const lane of Object.values(data.basePlan ?? {})) {
    for (const seg of lane) {
      if (seg.of && !lookup.has(seg.of)) {
        lookup.set(seg.of, {
          sku: seg.sku,
          vol: seg.vol,
        });
      }
    }
  }
  return lookup;
}

function hydrateSegment(seg, lookup) {
  if (!seg.of) return seg;
  const known = lookup.get(seg.of) ?? {};
  const preferKnownOrderDetails = seg.kind === 'ins';
  return {
    ...seg,
    sku: preferKnownOrderDetails ? (known.sku ?? seg.sku) : (seg.sku ?? known.sku),
    vol: preferKnownOrderDetails ? (known.vol ?? seg.vol) : (seg.vol ?? known.vol),
  };
}

function shiftHours(rec, seg, lineKey) {
  if (seg.kind !== 'shift') return null;
  const move = rec.moves?.find((m) => m.of === seg.of && m.line === lineKey);
  if (!move?.shift) return null;
  const hours = Number(String(move.shift).replace(/[^\d.-]/g, ''));
  return Number.isFinite(hours) ? hours : null;
}

/* nextStop — first cleaning or maintenance block in the forward plan.
   Returns { kind, hoursFromNow } or null when there's nothing scheduled. */
function nextStop(planned, timeUnit) {
  const seg = planned.find((s) => s.kind === 'clean' || s.kind === 'maint');
  if (!seg) return null;
  return { kind: seg.kind, hoursFromNow: Math.max(0, Math.round(unitsToHours(seg.start ?? 0, timeUnit))) };
}

function fmtCountdown(hours) {
  if (hours < 1)  return 'now';
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

function stoppageReasonLabel(key) {
  return {
    'breakdown': 'Breakdown',
    'no-material': 'No material',
    'no-operator': 'No operator',
    'quality-hold': 'Quality hold',
    'other': 'Other',
  }[key] || 'Stoppage';
}

function stoppageDurationLabel(key) {
  return {
    '15m': '15m', '30m': '30m', '1h': '1h', '2h+': '2h+', 'unknown': '—',
  }[key] || '—';
}

/* computeTodayScroll — derive the scrollLeft for the current zoom. Week and
   month views open on the current calendar week so the viewport reads as one
   week / five weeks instead of an arbitrary slice starting mid-week. Quarter
   keeps today at the left edge for longer-horizon scanning.
   Returns null when the lane doesn't actually need scrolling. */
function computeTodayScroll(body, zoom, pxPerDay) {
  if (!body) return null;
  const today = body.querySelector('.tl-today');
  if (!today || body.scrollWidth <= body.clientWidth) return null;
  const anchorBackDays = zoom === 'quarter' ? 0 : daysSinceWeekStart(TODAY);
  const target = today.offsetLeft - (anchorBackDays * pxPerDay);
  const maxScroll = Math.max(0, body.scrollWidth - body.clientWidth);
  return Math.min(maxScroll, Math.max(0, target));
}

/* normalizeRun — basePlan/executedHistory segments use { of, sku, vol, w }
   while RunDetailModal expects { material, sku, volume, durationHours }.
   Map at the wiring boundary so we don't push shape decisions into either
   the data layer or the modal. Service blocks pass through with their kind. */
function normalizeRun(seg, timeUnit) {
  if (!seg) return null;
  if (seg.kind === 'clean' || seg.kind === 'maint') {
    return { kind: seg.kind, durationHours: segDurationHours(seg, timeUnit) };
  }
  return {
    material: seg.of,
    sku: seg.sku,
    volume: seg.vol,
    oee: seg.oee,
    durationHours: segDurationHours(seg, timeUnit),
    format: seg.format,
  };
}

function laneFormatsFromRules(rule) {
  if (!rule?.formats) return [];
  return rule.formats.map((fmt) => fmt.label).filter(Boolean);
}

function MonthAggregateRun({ planned, baseline, timeUnit, pxPerDay, lineKey, onRunClick, todayX = 0 }) {
  const widthPx = aggregateWidthPx('month', pxPerDay);
  const weeks = buildWeekAggregates(planned, timeUnit);
  /* At month zoom, service blocks (clean/maint) are real events the
     planner needs to see at their precise axis date — not just rolled
     into a week-aggregate's cleanCount badge. Render them as their own
     small absolutely-positioned cards using the existing tc-service
     design so they pop against the week aggregates. */
  const serviceBlocks = (planned ?? []).filter(
    (s) => s?.kind === 'clean' || s?.kind === 'maint',
  );
  return (
    <>
      {weeks.map((week) => {
        const runRef = week.currentRun ?? week.firstRun ?? null;
        const seg = runRef?.seg ?? null;
        const prev = Number.isInteger(runRef?.index) && runRef.index > 0 ? planned[runRef.index - 1] : null;
        const next = Number.isInteger(runRef?.index) && runRef.index < planned.length - 1 ? planned[runRef.index + 1] : null;
        /* Position by axis date — the lane body lays executed cards out as
           a flex flow which drifts past their real time span (min-widths
           exceed pxPerDay), so a flex-flow aggregate would land several
           axis weeks to the right of where its week actually sits. Absolute
           positioning anchors each aggregate to the same coordinate the
           axis uses, so "Week 21" lands under W21. */
        const daysFromToday = Math.round((week.weekStart - TODAY) / 86400000);
        const left = todayX + daysFromToday * pxPerDay;
        return (
          <div
            key={week.key}
            className="tl-agg-slot"
            style={{ position: 'absolute', left, top: 12, bottom: 12, zIndex: 2 }}
          >
            <AggregateCard
              widthPx={widthPx}
              period="week"
              label={week.label}
              subLabel={week.subLabel}
              dominantMaterial={week.dominantMaterial}
              dominantSku={week.dominantSku}
              runCount={week.runCount}
              cleanCount={week.cleanCount}
              maintCount={week.maintCount}
              formats={week.formats}
              totalVolume={week.totalVolume}
              productiveHours={week.productiveHours}
              avgOee={week.avgOee}
              lineBaseline={baseline}
              isToday={week.isToday}
              hasUrgentInsert={week.hasUrgentInsert}
              isIdle={week.isIdle}
              onClick={seg && onRunClick ? () => onRunClick({
                seg: normalizeRun(seg, timeUnit),
                prev: normalizeRun(prev, timeUnit),
                next: normalizeRun(next, timeUnit),
                lineKey,
                index: runRef.index,
                baseline,
                state: 'planned',
              }) : null}
            />
          </div>
        );
      })}
      {serviceBlocks.map((seg, i) => {
        const startDays = segStartDays(seg, timeUnit);
        const durHours = segDurationHours(seg, timeUnit);
        const durDays = segDurationDays(seg, timeUnit);
        const left = todayX + startDays * pxPerDay;
        // Service blocks are 8h wide in time = ~9px at month zoom. Floor
        // at ~56px so the kind label + duration stay legible.
        const cardWidth = Math.max(56, Math.round(durDays * pxPerDay));
        return (
          <div
            key={`svc-${lineKey}-${seg.kind}-${seg.start}-${i}`}
            className="tl-month-svc"
            style={{ position: 'absolute', left, top: 12, bottom: 12, zIndex: 3 }}
          >
            <TimelineCard
              kind={seg.kind}
              durationHours={durHours}
              widthPx={cardWidth}
            />
          </div>
        );
      })}
    </>
  );
}

function buildWeekAggregates(planned, timeUnit) {
  const buckets = new Map();

  for (const [index, seg] of (planned ?? []).entries()) {
    const startDays = segStartDays(seg, timeUnit);
    const startDate = addDays(TODAY, startDays);
    const bucketStart = weekStart(startDate);
    const key = bucketStart.toISOString().slice(0, 10);
    if (!buckets.has(key)) {
      const bucketEnd = addDays(bucketStart, 6);
      buckets.set(key, {
        key,
        weekStart: bucketStart,
        label: `Week ${isoWeekNumber(bucketStart)}`,
        subLabel: `${fmtRangeDay(bucketStart)}-${fmtRangeDay(bucketEnd)}`,
        runCount: 0,
        cleanCount: 0,
        maintCount: 0,
        formats: new Set(),
        totalVolume: 0,
        productiveHours: 0,
        weightedOee: 0,
        weightedHours: 0,
        productionRuns: [],
        currentRun: null,
        hasUrgentInsert: false,
        isToday: bucketStart <= TODAY && TODAY <= bucketEnd,
      });
    }

    const bucket = buckets.get(key);
    if (seg.kind === 'clean') {
      bucket.cleanCount += 1;
      continue;
    }
    if (seg.kind === 'maint') {
      bucket.maintCount += 1;
      continue;
    }

    const hours = segDurationHours(seg, timeUnit);
    const fmt = deriveFormat({ sku: seg.sku, material: seg.of });
    bucket.runCount += 1;
    bucket.totalVolume += Number(seg.vol ?? 0) || 0;
    bucket.productiveHours += hours;
    const runRef = { seg, index };
    bucket.productionRuns.push(runRef);
    if (
      bucket.isToday &&
      bucket.currentRun == null &&
      segStartDays(seg, timeUnit) <= 0 &&
      0 < segStartDays(seg, timeUnit) + segDurationDays(seg, timeUnit)
    ) {
      bucket.currentRun = runRef;
    }
    if (fmt) bucket.formats.add(fmt);
    if (seg.oee != null) {
      bucket.weightedOee += Number(seg.oee) * hours;
      bucket.weightedHours += hours;
    }
    if (seg.kind === 'ins') bucket.hasUrgentInsert = true;
  }

  return [...buckets.values()]
    .sort((a, b) => a.weekStart - b.weekStart)
    .map((bucket) => {
      const dominant = bucket.productionRuns.length === 1 ? bucket.productionRuns[0].seg : null;
      return {
        ...bucket,
        formats: [...bucket.formats],
        totalVolume: Math.round(bucket.totalVolume),
        productiveHours: Math.round(bucket.productiveHours),
        avgOee: bucket.weightedHours > 0 ? bucket.weightedOee / bucket.weightedHours : null,
        dominantMaterial: dominant?.of ?? null,
        dominantSku: dominant?.sku ?? null,
        firstRun: bucket.productionRuns[0] ?? null,
        isIdle: bucket.runCount === 0,
      };
    });
}

function Lane({ lineKey, centre, baseline, formats = [], executed, planned, zoom, sync, primary = false, leadPadDays = 0, tailPadPx = 0, planHorizonDays = 1, todayX = 0, pxPerDay, timeUnit, orderLookup, onRunClick = null, moving = null, onMoveDrop = null, focusRun = null, lineRules = null, stoppage = null, issues = [], onResumeLine = null }) {
  /* Moving-mode derived state — null when no move is in flight. We
     compute compatibility and reason once per lane so the drop-zone
     children share the same verdict. */
  const isMoving = !!moving;
  const compatible = isMoving ? isLineCompatible(lineKey, moving.format, lineRules) : true;
  const reason = isMoving && !compatible ? incompatibleReason(lineKey, moving.format, lineRules) : null;
  const isSourceLane = isMoving && String(moving.fromLine) === String(lineKey);
  const [activeSlot, setActiveSlot] = useState(null);

  /* Drop handlers — shared by every drop zone in this lane. The slot
     index is what differs; pass it via the closure below. */
  function onZoneDragOver(e, slotIndex) {
    if (!isMoving || !compatible) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setActiveSlot(slotIndex);
  }
  function onZoneDragLeave() {
    setActiveSlot(null);
  }
  function onZoneDrop(e, slotIndex) {
    if (!isMoving || !compatible) return;
    e.preventDefault();
    setActiveSlot(null);
    onMoveDrop?.({ lineKey, slotIndex });
  }

  const bodyRef = useRef(null);
  useEffect(() => sync?.register(bodyRef.current, { primary }), [sync, primary]);
  const [drift, setDrift] = useState(0);

  /* Primary lane drives initial scroll position; secondary lanes follow via
     sync.broadcast. Run on mount and whenever zoom changes, and again after
     a 60ms tick to catch late font/layout loads. */
  useEffect(() => {
    if (!primary) return;
    const body = bodyRef.current;
    if (!body) return;
    const place = () => {
      const target = computeTodayScroll(body, zoom, pxPerDay);
      if (target != null) {
        body.scrollLeft = target;
        sync?.broadcast(body);
      }
      setDrift(0);
    };
    place();
    const t = setTimeout(place, 60);
    return () => clearTimeout(t);
  }, [zoom, sync, primary, pxPerDay]);

  useEffect(() => {
    if (!focusRun || String(focusRun.lineKey) !== String(lineKey)) return;
    const body = bodyRef.current;
    if (!body) return;

    const card = body.querySelector(`[data-tl-run-index="${focusRun.index}"]`);
    if (!card) return;

    const targetLeft = Math.max(0, card.offsetLeft - 24);
    body.scrollTo({ left: targetLeft, behavior: 'smooth' });
    const t = setTimeout(() => sync?.broadcast(body), 320);
    return () => clearTimeout(t);
  }, [focusRun, lineKey, sync]);

  function handleScroll() {
    const body = bodyRef.current;
    if (!body) return;
    sync?.broadcast(body);
    const target = computeTodayScroll(body, zoom, pxPerDay);
    if (target == null) { setDrift(0); return; }
    setDrift(Math.abs(body.scrollLeft - target));
  }

  function backToToday() {
    const body = bodyRef.current;
    if (!body) return;
    const target = computeTodayScroll(body, zoom, pxPerDay);
    if (target == null) return;
    body.scrollLeft = target;
    sync?.broadcast(body);
  }

  const showBack = primary && drift > 40;

  const laneClassName = [
    'tl-lane',
    stoppage ? 'tl-lane-stopped' : '',
    isMoving && compatible ? 'tl-lane-droptarget' : '',
    isMoving && !compatible ? 'tl-lane-incompat' : '',
    isMoving && isSourceLane ? 'tl-lane-source' : '',
  ].filter(Boolean).join(' ');

  const stoppageReason = stoppage ? stoppageReasonLabel(stoppage.reason) : null;
  const stoppageDuration = stoppage ? stoppageDurationLabel(stoppage.duration) : null;
  const showFuturePlan = !stoppage;
  const stoppageWidthPx = Math.max(
    138,
    Math.round(planHorizonDays * pxPerDay),
  );

  return (
    <div className={laneClassName} data-reason={reason || undefined}>
      {isMoving && !compatible && (
        <div className="tl-incompat-overlay" aria-hidden="true">
          <span className="tl-incompat-reason">{reason}</span>
        </div>
      )}
      <div className="tl-lane-head">
        <span className="ln">L{lineKey}</span>
        <span className="ce">{centre}</span>
        {baseline != null && (
          <span className="bl">
            Baseline {baseline.toFixed(2)}
            <InfoPopover title={`Line ${lineKey} baseline`}>
              <p>
                <b>{baseline.toFixed(2)}</b> is the <b>30-day rolling average OEE</b>
                {' '}for Line {lineKey}.
              </p>
              <p>
                <span className="ip-k">Source</span>
                <span className="ip-v">MES pull (Damm El&nbsp;Prat)</span>
              </p>
              <p>
                <span className="ip-k">Refresh</span>
                <span className="ip-v">Daily at 06:00 CET</span>
              </p>
              <p>
                <span className="ip-k">Window</span>
                <span className="ip-v">Last 30 production days (excluding planned downtime)</span>
              </p>
              <p className="ip-foot">
                Runs above the baseline are favourable; below it are flagged for review.
              </p>
            </InfoPopover>
          </span>
        )}
        {formats.length > 0 && (
          <span className="tl-lane-formats" aria-label="Compatible can formats">
            {formats.map((fmt) => (
              <span key={fmt} className="tl-lane-fmt-chip">{fmt}</span>
            ))}
          </span>
        )}
        <IssueBadge issues={issues} lineKey={lineKey} />
        {stoppage ? (
          <div className="tl-stopped-badge" role="status">
            <span className="sb-dot" aria-hidden="true" />
            <div className="sb-body">
              <span className="sb-h">Stopped</span>
              <span className="sb-reason">{stoppageReason}</span>
            </div>
            <span className="sb-dur">{stoppageDuration}</span>
            {onResumeLine && (
              <button
                type="button"
                className="sb-resume"
                onClick={() => onResumeLine(lineKey)}
                aria-label={`Mark L${lineKey} resumed`}
                title="Mark line resumed"
              >Resume</button>
            )}
          </div>
        ) : (() => {
          const stop = nextStop(planned, timeUnit);
          if (!stop) return null;
          return (
            <div className={`tl-next-stop tl-next-stop-${stop.kind}`}>
              <span className="ns-h">Next stop</span>
              <div className="ns-row">
                <span className="ns-ic">{stop.kind === 'clean' ? '⚙' : '🔧'}</span>
                <span className="ns-lbl">{stop.kind === 'clean' ? 'Clean' : 'Maint'}</span>
              </div>
              <span className="ns-when">{fmtCountdown(stop.hoursFromNow)}</span>
            </div>
          );
        })()}
      </div>
      <div className="tl-lane-body" ref={bodyRef} onScroll={handleScroll}>
        {leadPadDays > 0 && (
          <div
            className="tl-lead-pad"
            aria-hidden="true"
            style={{ flex: 'none', width: leadPadDays * pxPerDay }}
          />
        )}
        {(() => {
          const execEnd = executedEnd(executed, timeUnit);
          return executed.map((seg, i) => {
            const prev = i > 0 ? executed[i - 1] : null;
            const next = i < executed.length - 1 ? executed[i + 1] : (planned[0] ?? null);
            return (
              <SegmentCard
                key={`e-${lineKey}-${i}`}
                seg={seg}
                baseline={baseline}
                state="executed"
                zoom={zoom}
                pxPerDay={pxPerDay}
                timeUnit={timeUnit}
                dateLabel={dayRange(segStartDays(seg, timeUnit) - execEnd, segDurationDays(seg, timeUnit))}
                onClick={onRunClick ? () => onRunClick({ seg: normalizeRun(seg, timeUnit), prev: normalizeRun(prev, timeUnit), next: normalizeRun(next, timeUnit), lineKey, index: i, baseline, state: 'executed' }) : null}
              />
            );
          });
        })()}
        <div className="tl-today" aria-label="current" style={{ left: todayX }} />
        {stoppage && (
          <div
            className="tl-stoppage-block tl-stoppage-block-long"
            style={{ width: stoppageWidthPx }}
            aria-label={`L${lineKey} stopped from now through latest planned date: ${stoppageReason}, ${stoppageDuration}`}
          >
            <span className="tsb-body">
              <span className="tsb-k">Stopped now</span>
              <span className="tsb-r">{stoppageReason}</span>
              <span className="tsb-d">{stoppageDuration}</span>
              <span className="tsb-until">Through latest plan</span>
            </span>
          </div>
        )}
        {/* In moving mode + compatible lane, render a drop zone before
            each segment and one trailing zone at the end. We use simple
            sibling elements (not absolutely positioned) so the lane's
            horizontal flow naturally separates the slots. */}
        {showFuturePlan && isMoving && compatible && (
          <DropZone
            slotIndex={0}
            active={activeSlot === 0}
            isFirst
            runWidthPx={Math.max(MIN_CARD_WIDTH[zoom] ?? 168, Math.round(segDurationDays(moving.run, timeUnit) * pxPerDay))}
            onDragOver={onZoneDragOver}
            onDragLeave={onZoneDragLeave}
            onDrop={onZoneDrop}
          />
        )}
        {showFuturePlan && !isMoving && zoom === 'month' ? (
          <MonthAggregateRun
            planned={planned.map((seg) => hydrateSegment(seg, orderLookup))}
            baseline={baseline}
            timeUnit={timeUnit}
            pxPerDay={pxPerDay}
            lineKey={lineKey}
            onRunClick={onRunClick}
            todayX={todayX}
          />
        ) : showFuturePlan && planned.map((seg, i) => {
          const displaySeg = hydrateSegment(seg, orderLookup);
          const prev = i > 0 ? planned[i - 1] : (executed[executed.length - 1] ?? null);
          const next = i < planned.length - 1 ? planned[i + 1] : null;
          const isSourceRun = isMoving && isSourceLane && i === moving.fromIndex;
          /* When this is the source run during a move, we render nothing —
             the gap itself communicates "this slot is up for relocation."
             A ghost card was tested but added visual noise (Maria asked
             for "remove the old one"). */
          if (isSourceRun) return null;
          return (
            <Fragment key={`p-${lineKey}-${i}`}>
              <SegmentCard
                seg={displaySeg}
                baseline={baseline}
                state="planned"
                zoom={zoom}
                pxPerDay={pxPerDay}
                timeUnit={timeUnit}
                dateLabel={dayRange(segStartDays(seg, timeUnit), segDurationDays(seg, timeUnit))}
                focusIndex={i}
                focused={
                  focusRun
                  && String(focusRun.lineKey) === String(lineKey)
                  && focusRun.index === i
                  && (!focusRun.of || focusRun.of === displaySeg.of)
                }
                onClick={onRunClick ? () => onRunClick({ seg: normalizeRun(displaySeg, timeUnit), prev: normalizeRun(prev, timeUnit), next: normalizeRun(next, timeUnit), lineKey, index: i, baseline, state: 'planned' }) : null}
              />
              {isMoving && compatible && (
                <DropZone
                  slotIndex={i + 1}
                  active={activeSlot === i + 1}
                  runWidthPx={Math.max(MIN_CARD_WIDTH[zoom] ?? 168, Math.round(segDurationDays(moving.run, timeUnit) * pxPerDay))}
                  onDragOver={onZoneDragOver}
                  onDragLeave={onZoneDragLeave}
                  onDrop={onZoneDrop}
                />
              )}
            </Fragment>
          );
        })}
        {tailPadPx > 0 && (
          <div
            className="tl-tail-pad"
            aria-hidden="true"
            style={{ flex: 'none', width: tailPadPx }}
          />
        )}
      </div>
      {showBack && (
        <button
          type="button"
          className="tl-back-today"
          onClick={backToToday}
          title="Scroll back to current"
        >
          ← Current
        </button>
      )}
    </div>
  );
}

function SegmentCard({ seg, baseline, state, zoom, pxPerDay, timeUnit, shiftFromHours = null, dateLabel, onClick = null, ghost = false, focusIndex = null, focused = false }) {
  const durationHours = segDurationHours(seg, timeUnit);
  const widthPx = segmentWidthPx(seg, zoom, pxPerDay, timeUnit);

  if (seg.kind === 'clean' || seg.kind === 'maint') {
    return (
      <TimelineCard
        kind={seg.kind}
        durationHours={durationHours}
        widthPx={widthPx}
        dateLabel={dateLabel}
      />
    );
  }

  const variantKind = seg.kind === 'ins' || seg.kind === 'shift' ? seg.kind : null;

  return (
    <TimelineCard
      material={seg.of}
      sku={seg.sku}
      volume={seg.vol}
      oee={seg.oee}
      lineBaseline={baseline}
      durationHours={durationHours}
      widthPx={widthPx}
      state={state}
      kind={variantKind}
      shiftFromHours={shiftFromHours}
      dateLabel={dateLabel}
      focusIndex={focusIndex}
      focused={focused}
      onClick={ghost ? null : onClick}
      ghost={ghost}
    />
  );
}

/* DropZone — a target rendered between segments in moving mode. At rest
   shows as a slim dashed bar; when active, expands to the full pixel
   width the moved run would occupy on this lane (so Maria sees the
   actual footprint of where it'd land before she releases). */
function DropZone({ slotIndex, active, isFirst = false, runWidthPx = 96, onDragOver, onDragLeave, onDrop }) {
  /* When active, we expand to the run's actual pixel footprint so Maria
     can preview the landing dimensions before releasing. Setting
     min-width alongside flex-basis defends against any flex parent
     constraints that might otherwise clamp the basis. */
  const activeStyle = active
    ? { flexBasis: `${runWidthPx}px`, minWidth: `${runWidthPx}px` }
    : undefined;
  function activateDrop(e) {
    onDrop(e, slotIndex);
  }

  return (
    <button
      type="button"
      className={`tl-dropzone${active ? ' tl-dropzone-active' : ''}${isFirst ? ' tl-dropzone-first' : ''}`}
      style={activeStyle}
      onDragOver={(e) => onDragOver(e, slotIndex)}
      onDragLeave={onDragLeave}
      onDrop={activateDrop}
      onClick={activateDrop}
      aria-label={`Place here at position ${slotIndex}`}
    >
      <div className="tl-dropzone-bar" />
      {active && <div className="tl-dropzone-label">Place here · {fmtDays(runWidthPx)}</div>}
    </button>
  );
}

/* fmtDays — used in the active drop-zone label to give Maria a
   readable footprint readout (e.g. "Drop here · 1.6d"). Pure helper. */
function fmtDays(runWidthPx) {
  // We can't know zoom directly here; runWidthPx already encodes it.
  // Show approximate days assuming 200px/day at week zoom — close
  // enough for the in-flight label. Refined when zoom is threaded in.
  const approxDays = runWidthPx / 200;
  return approxDays < 1 ? `${Math.round(approxDays * 24)}h` : `${approxDays.toFixed(1)}d`;
}
