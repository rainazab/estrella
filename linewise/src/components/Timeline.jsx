import { Fragment, useEffect, useRef, useState } from 'react';
import TimelineCard from './TimelineCard.jsx';
import InfoPopover from './InfoPopover.jsx';
import IssueBadge from './IssueBadge.jsx';
import { isLineCompatible, incompatibleReason } from '../lib/movePlan.js';

/* Timeline — three line lanes (14, 17, 19), each a horizontally-scrolling
   row of TimelineCards. Executed-history cards (faded) flow first, then a
   TODAY divider, then planned cards.

   `seg.w` from plan.json is the run's duration in days; we feed it to
   TimelineCard as `durationHours` so the card's text shows it correctly,
   and we drive horizontal scale with `widthPx = max(168, w * px-per-day)`
   so card width is proportional to duration. */

const LINES = ['14', '17', '19'];

const FALLBACK_WIDTH_PER_DAY = { week: 124, month: 28, quarter: 14 };
const VISIBLE_DAYS = { week: 7, month: 35, quarter: 70 };
const MIN_CARD_WIDTH = { week: 168, month: 80, quarter: 36 };
const TIMELINE_HEAD_WIDTH = 128;

/* Date helpers — turn seg.start (days from a lane's reference point) and
   seg.w (duration in days) into a label like "Mon 19" or "Mon 19 → Wed 21".
   TODAY is hardcoded to match the prototype; later this should come from
   data.today on the server payload. */
const TODAY = new Date(2026, 4, 23);
const WK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + Math.round(days));
  return d;
}

function fmtDay(d) {
  return `${WK[d.getDay()]} ${d.getDate()}`;
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

function dayRange(startOffsetHours, durationHours) {
  const startD = addDays(TODAY, startOffsetHours / 24);
  const endD   = addDays(TODAY, (startOffsetHours + durationHours) / 24);
  if (startD.toDateString() === endD.toDateString()) return fmtDay(startD);
  return `${fmtDay(startD)} → ${fmtDay(endD)}`;
}

/* executedEndHours / plannedEndHours — cumulative end (in HOURS) of the
   last segment in a lane. The contract emits `start` and `w` in hours
   (see docs/API_CONTRACT.md), so timeline layout converts hours → pixels
   via pxPerHour = pxPerDay/24. Earlier versions of this file assumed
   days; if you see `seg.w * 24` anywhere, that was the bug. */
function executedEndHours(executed) {
  if (!executed?.length) return 0;
  return Math.max(...executed.map((s) => (s.start ?? 0) + (s.w ?? 0)));
}

function plannedEndHours(seg) {
  return (seg?.start ?? 0) + (seg?.w ?? 0);
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
  stoppages = [],
  issues = [],
  onResumeLine = null,
}) {
  const timelineRef = useRef(null);
  const sync = useSharedScroll();
  const viewportWidth = useTimelineViewportWidth(timelineRef);
  const pxPerDay = pxPerDayForZoom(zoom, viewportWidth);
  const pxPerHour = pxPerDay / 24;
  const minCardWidth = MIN_CARD_WIDTH[zoom] ?? 168;
  /* execHoursByLine — total executed window per lane in HOURS. */
  const execHoursByLine = mode === 'default'
    ? LINES.map((k) => executedEndHours(data?.executedHistory?.[k] ?? []))
    : LINES.map(() => 0);
  const maxExecHours = Math.max(0, ...execHoursByLine);
  const execDays = maxExecHours / 24;       // axis-friendly, fractional ok
  const activePlan = effectivePlan ?? data.basePlan;
  const planHorizonHours = Math.max(
    24,
    ...LINES.flatMap((k) => (activePlan?.[k] ?? []).map(plannedEndHours)),
  );
  /* Card rendered widths are clamped to MIN_CARD_WIDTH for legibility,
     so positioning the NOW line by *time* (maxExecHours × pxPerHour)
     leaves executed cards overlapping the line. Compute the RENDERED
     px footprint of each lane's executed history and align the divider
     across lanes via lead-padding instead. NOW becomes an inline
     flex-none element sitting between executed and planned cards — the
     ordering is enforced by DOM. */
  const execRenderedPxByLine = LINES.map((k) => {
    if (mode !== 'default') return 0;
    const lane = data?.executedHistory?.[k] ?? [];
    return lane.reduce(
      (acc, seg) => acc + Math.max(minCardWidth, Math.round((seg.w ?? 0) * pxPerHour)),
      0,
    );
  });
  const maxExecRenderedPx = Math.max(0, ...execRenderedPxByLine);
  // todayX is still computed for the TimelineAxis (which uses time units).
  const todayX = maxExecHours * pxPerHour;

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
            pxPerHour={pxPerHour}
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
        const laneExecRenderedPx = execRenderedPxByLine[idx] ?? 0;
        const preNowPadPx = Math.max(0, maxExecRenderedPx - laneExecRenderedPx);
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
            preNowPadPx={preNowPadPx}
            planHorizonHours={planHorizonHours}
            todayX={todayX}
            pxPerDay={pxPerDay}
            pxPerHour={pxPerHour}
            onRunClick={onRunClick}
            moving={moving}
            onMoveDrop={onMoveDrop}
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
              aria-label={`${isToday ? 'Today, ' : ''}week ${week}`}
            >
              {isToday && <span className="tl-axis-dow">Today</span>}
              <span className="tl-axis-date">W{week}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecommendationLane({ data, lineKey, rec, zoom, showNaive, sync, primary = false, todayX = 0, pxPerDay, pxPerHour }) {
  const ppH = pxPerHour ?? (pxPerDay / 24);
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
            <span className="ns-h">LineWise</span>
            <div className="ns-row">
              <span className="ns-lbl">Recommended</span>
            </div>
            <span className="ns-when">{rec.oeeDelta} OEE</span>
          </div>
        )}
      </div>
      <div className="tl-lane-body" ref={bodyRef} onScroll={() => sync?.broadcast(bodyRef.current)}>
        <div className="tl-now-inline" aria-label="now divider">
          {primary && (
            <span className="tl-now-inline-label">
              <span className="tl-now-inline-l-now">NOW</span>
            </span>
          )}
        </div>
        {proposed.map((seg, index) => (
          <SegmentCard
            key={`r-${lineKey}-${seg.of ?? seg.kind}-${index}`}
            seg={hydrateSegment(seg, lookup)}
            baseline={baseline}
            state="planned"
            zoom={zoom}
            pxPerDay={pxPerDay}
            pxPerHour={ppH}
            shiftFromHours={shiftHours(rec, seg, lineKey)}
            dateLabel={dayRange(seg.start ?? 0, seg.w ?? 0)}
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
            pxPerHour={ppH}
            dateLabel="previous slot"
          />
        ))}
        {naiveHere && (
          <div className="tl-decision-marker tl-naive-marker">
            <span>Naive slot</span>
            <b>{Math.round(naiveHere.w ?? 0)}h exposure</b>
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
  return {
    ...seg,
    sku: seg.sku ?? known.sku,
    vol: seg.vol ?? known.vol,
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
function nextStop(planned) {
  const seg = planned.find((s) => s.kind === 'clean' || s.kind === 'maint');
  if (!seg) return null;
  return { kind: seg.kind, hoursFromNow: Math.max(0, Math.round(seg.start ?? 0)) };
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

/* computeTodayScroll — derive the scrollLeft so the NOW divider lands at
   the leftmost visible position of the lane body. Executed history is
   available by scrolling LEFT from there; forward plan is the default
   view. Same behaviour for every zoom level.
   Returns null when the lane doesn't actually need scrolling. */
function computeTodayScroll(body, _zoom, _pxPerDay) {
  if (!body) return null;
  const today = body.querySelector('.tl-now-inline');
  if (!today || body.scrollWidth <= body.clientWidth) return null;
  const target = today.offsetLeft;
  const maxScroll = Math.max(0, body.scrollWidth - body.clientWidth);
  return Math.min(maxScroll, Math.max(0, target));
}

/* normalizeRun — basePlan/executedHistory segments use { of, sku, vol, w }
   while RunDetailModal expects { material, sku, volume, durationHours }.
   Map at the wiring boundary so we don't push shape decisions into either
   the data layer or the modal. Service blocks pass through with their kind. */
function normalizeRun(seg) {
  if (!seg) return null;
  if (seg.kind === 'clean' || seg.kind === 'maint') {
    return { kind: seg.kind, durationHours: seg.w ?? 0 };
  }
  return {
    material: seg.of,
    sku: seg.sku,
    volume: seg.vol,
    oee: seg.oee,
    durationHours: seg.w ?? 0,
    format: seg.format,
  };
}

function laneFormatsFromRules(rule) {
  if (!rule?.formats) return [];
  return rule.formats.map((fmt) => fmt.label).filter(Boolean);
}

function Lane({ lineKey, centre, baseline, formats = [], executed, planned, zoom, sync, primary = false, preNowPadPx = 0, planHorizonHours = 1, todayX = 0, pxPerDay, pxPerHour, onRunClick = null, moving = null, onMoveDrop = null, stoppage = null, issues = [], onResumeLine = null }) {
  // Defensive: if a caller forgot pxPerHour, derive it.
  const ppH = pxPerHour ?? (pxPerDay / 24);
  /* Moving-mode derived state — null when no move is in flight. We
     compute compatibility and reason once per lane so the drop-zone
     children share the same verdict. */
  const isMoving = !!moving;
  const compatible = isMoving ? isLineCompatible(lineKey, moving.format) : true;
  const reason = isMoving && !compatible ? incompatibleReason(lineKey, moving.format) : null;
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
    Math.round(planHorizonHours * ppH),
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
          const stop = nextStop(planned);
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
        {preNowPadPx > 0 && (
          <div
            className="tl-lead-pad"
            aria-hidden="true"
            style={{ flex: 'none', width: preNowPadPx }}
          />
        )}
        {(() => {
          const execEnd = executedEndHours(executed);
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
                pxPerHour={ppH}
                dateLabel={dayRange((seg.start ?? 0) - execEnd, seg.w ?? 0)}
                onClick={onRunClick ? () => onRunClick({ seg: normalizeRun(seg), prev: normalizeRun(prev), next: normalizeRun(next), lineKey, baseline, state: 'executed' }) : null}
              />
            );
          });
        })()}
        {/* Inline NOW divider — always sits between executed and planned
            cards in DOM order, so the gray-vs-color boundary is enforced
            visually even when rendered card widths exceed the cards'
            true hour-footprint. Aligned across lanes via preNowPadPx. */}
        <div className="tl-now-inline" aria-label="now divider">
          {primary && (
            <span className="tl-now-inline-label">
              <span className="tl-now-inline-l-now">NOW</span>
            </span>
          )}
        </div>
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
            runWidthPx={Math.max(MIN_CARD_WIDTH[zoom] ?? 168, Math.round((moving.run.w ?? 1) * ppH))}
            onDragOver={onZoneDragOver}
            onDragLeave={onZoneDragLeave}
            onDrop={onZoneDrop}
          />
        )}
        {showFuturePlan && planned.map((seg, i) => {
          const prev = i > 0 ? planned[i - 1] : (executed[executed.length - 1] ?? null);
          const next = i < planned.length - 1 ? planned[i + 1] : null;
          const isSourceRun = isMoving && isSourceLane && seg.of && seg.of === moving.run.of;
          /* When this is the source run during a move, we render nothing —
             the gap itself communicates "this slot is up for relocation."
             A ghost card was tested but added visual noise (Maria asked
             for "remove the old one"). */
          if (isSourceRun) return null;
          return (
            <Fragment key={`p-${lineKey}-${i}`}>
              <SegmentCard
                seg={seg}
                baseline={baseline}
                state="planned"
                zoom={zoom}
                pxPerDay={pxPerDay}
                pxPerHour={ppH}
                dateLabel={dayRange(seg.start ?? 0, seg.w ?? 0)}
                onClick={onRunClick ? () => onRunClick({ seg: normalizeRun(seg), prev: normalizeRun(prev), next: normalizeRun(next), lineKey, baseline, state: 'planned' }) : null}
              />
              {isMoving && compatible && (
                <DropZone
                  slotIndex={i + 1}
                  active={activeSlot === i + 1}
                  runWidthPx={Math.max(MIN_CARD_WIDTH[zoom] ?? 168, Math.round((moving.run.w ?? 1) * ppH))}
                  onDragOver={onZoneDragOver}
                  onDragLeave={onZoneDragLeave}
                  onDrop={onZoneDrop}
                />
              )}
            </Fragment>
          );
        })}
      </div>
      {showBack && (
        <button
          type="button"
          className="tl-back-today"
          onClick={backToToday}
          title="Scroll back to today"
        >
          ← Today
        </button>
      )}
    </div>
  );
}

function SegmentCard({ seg, baseline, state, zoom, pxPerDay, pxPerHour, shiftFromHours = null, dateLabel, onClick = null, ghost = false }) {
  /* `seg.w` is in HOURS per the v2.3+ contract. Convert to pixels via
     pxPerHour, not pxPerDay (that's the bug that made 8h runs render as
     8 days wide). */
  const durationHours = seg.w ?? 1;
  const ppH = pxPerHour ?? (pxPerDay / 24);
  const widthPx = Math.max(
    MIN_CARD_WIDTH[zoom] ?? 168,
    Math.round(durationHours * ppH),
  );

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
  return (
    <div
      className={`tl-dropzone${active ? ' tl-dropzone-active' : ''}${isFirst ? ' tl-dropzone-first' : ''}`}
      style={activeStyle}
      onDragOver={(e) => onDragOver(e, slotIndex)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, slotIndex)}
      aria-label={`Drop here at position ${slotIndex}`}
    >
      <div className="tl-dropzone-bar" />
      {active && <div className="tl-dropzone-label">Drop here · {fmtDays(runWidthPx, slotIndex)}</div>}
    </div>
  );
}

/* fmtDays — used in the active drop-zone label to give Maria a
   readable footprint readout (e.g. "Drop here · 1.6d"). Pure helper. */
function fmtDays(runWidthPx, _slotIndex) {
  // We can't know zoom directly here; runWidthPx already encodes it.
  // Show approximate days assuming 200px/day at week zoom — close
  // enough for the in-flight label. Refined when zoom is threaded in.
  const approxDays = runWidthPx / 200;
  return approxDays < 1 ? `${Math.round(approxDays * 24)}h` : `${approxDays.toFixed(1)}d`;
}
