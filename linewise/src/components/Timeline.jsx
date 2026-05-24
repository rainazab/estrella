import { Fragment, useEffect, useRef, useState } from 'react';
import TimelineCard from './TimelineCard.jsx';
import InfoPopover from './InfoPopover.jsx';
import { isLineCompatible, incompatibleReason } from '../lib/movePlan.js';
import { allowedFormats } from '../lib/lineRules.js';

/* Timeline — three line lanes (14, 17, 19), each a horizontally-scrolling
   row of TimelineCards. Executed-history cards (faded) flow first, then a
   TODAY divider, then planned cards.

   `seg.w` from plan.json is the run's duration in backend-declared units
   (`timeline.timeUnit`, currently hours); Timeline converts that to hours
   for labels and days for calendar geometry. */

const LINES = ['14', '17', '19'];

const WIDTH_PER_DAY = { week: 200, month: 90, quarter: 40 };
const MIN_CARD_WIDTH = { week: 36, month: 30, quarter: 24 };
const DEFAULT_TIMELINE = {
  anchorDate: new Date().toISOString().slice(0, 10),
  anchorLabel: 'Today',
  timeUnit: 'hours',
  views: {
    week: { daysBack: 7, daysAhead: 14 },
    month: { daysBack: 14, daysAhead: 35 },
    quarter: { daysBack: 30, daysAhead: 90 },
  },
};

/* Date helpers — turn seg.start and seg.w into a label like "Mon 19" or
   "Mon 19 → Wed 21".
   The backend owns the anchor date and whether segment offsets are hours
   or days; geometry converts everything to days for the calendar axis. */
const WK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function timelineConfig(timeline) {
  const views = {};
  for (const key of Object.keys(DEFAULT_TIMELINE.views)) {
    views[key] = {
      ...DEFAULT_TIMELINE.views[key],
      ...(timeline?.views?.[key] ?? {}),
    };
  }
  return {
    ...DEFAULT_TIMELINE,
    ...(timeline ?? {}),
    views,
  };
}

function parseAnchorDate(value) {
  const text = typeof value === 'string' ? value.slice(0, 10) : DEFAULT_TIMELINE.anchorDate;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function valueToDays(value, timeline) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return timeline.timeUnit === 'days' ? n : n / 24;
}

function valueToHours(value, timeline) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return timeline.timeUnit === 'days' ? n * 24 : n;
}

function widthForDuration(value, zoom, timeline) {
  const durationDays = Math.max(0, valueToDays(value, timeline));
  return Math.max(
    MIN_CARD_WIDTH[zoom] ?? 168,
    Math.round(durationDays * (WIDTH_PER_DAY[zoom] ?? 200)),
  );
}

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + Math.round(days));
  return d;
}

function fmtDay(d) {
  return `${WK[d.getDay()]} ${d.getDate()}`;
}

function dayRange(startOffset, duration, timeline) {
  const today = parseAnchorDate(timeline.anchorDate);
  const startOffsetDays = valueToDays(startOffset, timeline);
  const durationDays = valueToDays(duration, timeline);
  const startD = addDays(today, startOffsetDays);
  const endD   = addDays(today, startOffsetDays + durationDays);
  if (startD.toDateString() === endD.toDateString()) return fmtDay(startD);
  return `${fmtDay(startD)} → ${fmtDay(endD)}`;
}

/* executedEnd — cumulative end (in days) of the last executed segment for
   a lane. Used to translate executed seg.start (canvas-relative, starting
   from the beginning of the executed window) into a day offset from today
   (negative for past runs). */
function executedEnd(executed) {
  if (!executed?.length) return 0;
  return Math.max(...executed.map((s) => (s.start ?? 0) + (s.w ?? 0)));
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
  lineRules = null,
  weeklyStops = null,
  urgentDrop = null,
  onUrgentDrop = null,
  events = {},
}) {
  const sync = useSharedScroll();
  const timeline = timelineConfig(data?.timeline);
  const syncedLineKey = LINES[0];
  const execDays = mode === 'default'
    ? Math.ceil(valueToDays(executedEnd(data?.executedHistory?.[syncedLineKey] ?? []), timeline))
    : 0;

  if (mode !== 'default') {
    if (!rec) {
      return (
        <div className="tl-placeholder">
          Timeline ({mode} mode) — choose a recommendation first.
        </div>
      );
    }

    return (
      <div className="tl">
        <TimelineAxis zoom={zoom} sync={sync} timeline={timeline} executedDays={execDays} />
        {LINES.map((lineKey, idx) => (
          <RecommendationLane
            key={lineKey}
            data={data}
            lineKey={lineKey}
            rec={rec}
            zoom={zoom}
            timeline={timeline}
            showNaive={showNaive}
            sync={sync}
            primary={idx === 0}
            lineRules={lineRules ?? data?.lineRules}
            weeklyStops={weeklyStops ?? data?.weeklyStops}
            urgentDrop={urgentDrop}
            onUrgentDrop={onUrgentDrop}
            events={events?.[lineKey] ?? []}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={`tl${moving ? ' tl-moving' : ''}`}>
      <TimelineAxis zoom={zoom} sync={sync} timeline={timeline} executedDays={execDays} />
      {LINES.map((lineKey, idx) => {
        const planned = (effectivePlan ?? data.basePlan)?.[lineKey] ?? [];
        const displayPlanned = mergeWeeklyStops(planned, (weeklyStops ?? data?.weeklyStops)?.[lineKey] ?? []);
        return (
          <Lane
            key={lineKey}
            lineKey={lineKey}
            centre={data.lineCentre?.[lineKey] ?? 'CF Prat'}
            baseline={data.lineBaseline?.[lineKey]}
            executed={data.executedHistory?.[lineKey] ?? []}
            planned={planned}
            displayPlanned={displayPlanned}
            zoom={zoom}
            timeline={timeline}
            sync={sync}
            primary={idx === 0}
            onRunClick={onRunClick}
            moving={moving}
            onMoveDrop={onMoveDrop}
            lineRules={lineRules ?? data?.lineRules}
            events={events?.[lineKey] ?? []}
          />
        );
      })}
    </div>
  );
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
function TimelineAxis({ zoom, sync, timeline, executedDays = 0 }) {
  const axisBodyRef = useRef(null);
  const pxPerDay = WIDTH_PER_DAY[zoom] ?? 200;
  const view = timeline.views?.[zoom] ?? DEFAULT_TIMELINE.views.week;
  const RANGE_START = -Math.max(Number(view.daysBack ?? 0), executedDays);
  const RANGE_END = Number(view.daysAhead ?? DEFAULT_TIMELINE.views.week.daysAhead);
  const today = parseAnchorDate(timeline.anchorDate);

  useEffect(() => sync?.register(axisBodyRef.current), [sync]);

  const days = [];
  for (let i = RANGE_START; i <= RANGE_END; i++) days.push(i);

  return (
    <div className="tl-axis">
      <div className="tl-axis-head" aria-hidden="true" />
      <div className="tl-axis-body" ref={axisBodyRef}>
        <div className="tl-axis-today" aria-hidden="true" style={{ left: Math.abs(RANGE_START) * pxPerDay }} />
        {days.map((offset) => {
          const date = addDays(today, offset);
          const isToday = offset === 0;
          const isMonthStart = date.getDate() === 1;
          const isWeekStart = date.getDay() === 1;
          const labelEveryDay = zoom !== 'quarter';
          return (
            <div
              key={offset}
              className={`tl-axis-day${isToday ? ' is-today' : ''}${isWeekStart ? ' is-week-start' : ''}${isMonthStart ? ' is-month-start' : ''}`}
              style={{ width: pxPerDay }}
            >
              {(labelEveryDay || isWeekStart || isMonthStart) && (
                <>
                  <span className="tl-axis-dow">{isToday ? (timeline.anchorLabel || 'Today') : WK[date.getDay()]}</span>
                  <span className="tl-axis-date">
                    {isMonthStart ? date.toLocaleString('en-US', { month: 'short' }) + ' ' : ''}
                    {date.getDate()}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecommendationLane({
  data,
  lineKey,
  rec,
  zoom,
  timeline,
  showNaive,
  sync,
  primary = false,
  lineRules = null,
  weeklyStops = null,
  urgentDrop = null,
  onUrgentDrop = null,
  events = [],
}) {
  const proposed = mergeWeeklyStops(rec.plan?.[lineKey] ?? [], weeklyStops?.[lineKey] ?? []);
  const ghosts = rec.ghosts?.[lineKey] ?? [];
  const naiveHere = showNaive && rec.naiveBand?.line === lineKey ? rec.naiveBand : null;
  const recoveryHere = rec.recovery?.line === lineKey ? rec.recovery : null;
  const baseline = data.lineBaseline?.[lineKey];
  const lookup = buildOrderLookup(data);
  const isUrgentDragging = !!urgentDrop?.active;
  const urgentCompatible = isUrgentDragging ? isLineCompatible(lineKey, urgentDrop.format, lineRules) : true;
  const urgentReason = isUrgentDragging && !urgentCompatible
    ? incompatibleReason(lineKey, urgentDrop.format, lineRules)
    : null;
  const [activeSlot, setActiveSlot] = useState(null);
  const bodyRef = useRef(null);
  useEffect(() => sync?.register(bodyRef.current, { primary }), [sync, primary]);
  useEffect(() => {
    if (!primary) return;
    const t = setTimeout(() => { sync?.broadcast(bodyRef.current); }, 60);
    return () => clearTimeout(t);
  }, [primary, sync, zoom]);

  function onZoneDragOver(e, slotIndex, anchorOf = null) {
    if (!isUrgentDragging || !urgentCompatible) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setActiveSlot(`${slotIndex}-${anchorOf ?? 'start'}`);
  }

  function onZoneDrop(e, slotIndex, anchorOf = null) {
    if (!isUrgentDragging || !urgentCompatible) return;
    e.preventDefault();
    setActiveSlot(null);
    onUrgentDrop?.({ lineKey, slotIndex, anchorOf });
  }

  const laneClassName = [
    'tl-lane',
    rec.line.endsWith(lineKey) ? 'tl-lane-recommended' : '',
    isUrgentDragging && urgentCompatible ? 'tl-lane-droptarget' : '',
    isUrgentDragging && !urgentCompatible ? 'tl-lane-incompat' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={laneClassName} data-reason={urgentReason || undefined}>
      {isUrgentDragging && !urgentCompatible && (
        <div className="tl-incompat-overlay" aria-hidden="true">
          <span className="tl-incompat-reason">{urgentReason}</span>
        </div>
      )}
      <div className="tl-lane-head">
        <span className="ln">L{lineKey}</span>
        <span className="ce">{data.lineCentre?.[lineKey] ?? 'CF Prat'}</span>
        <LineRuleChips lineKey={lineKey} lineRules={lineRules} />
        {baseline != null && <span className="bl">Baseline {baseline.toFixed(2)}</span>}
        <LineEvents events={events} />
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
        <div className="tl-today" aria-label="now" />
        {isUrgentDragging && urgentCompatible && (
          <DropZone
            slotIndex={0}
            active={activeSlot === '0-start'}
            isFirst
            runWidthPx={widthForDuration(urgentDrop?.w ?? 8, zoom, timeline)}
            onDragOver={(e, slot) => onZoneDragOver(e, slot, null)}
            onDragLeave={() => setActiveSlot(null)}
            onDrop={(e, slot) => onZoneDrop(e, slot, null)}
          />
        )}
        {proposed.map((seg, index) => {
          const isService = seg.kind === 'clean' || seg.kind === 'maint';
          const slotIndex = isService ? seg._slotBefore : (seg._planIndex ?? index) + 1;
          const anchorOf = isService ? null : seg.of;
          return (
            <Fragment key={`r-${lineKey}-${seg.of ?? seg.id ?? seg.kind}-${index}`}>
              <SegmentCard
                seg={hydrateSegment(seg, lookup)}
                baseline={baseline}
                state="planned"
                zoom={zoom}
                timeline={timeline}
                shiftFromHours={shiftHours(rec, seg, lineKey)}
                dateLabel={dayRange(seg.start ?? 0, seg.w ?? 0, timeline)}
              />
              {!isService && isUrgentDragging && urgentCompatible && (
                <DropZone
                  slotIndex={slotIndex}
                  active={activeSlot === `${slotIndex}-${anchorOf ?? 'start'}`}
                  runWidthPx={widthForDuration(urgentDrop?.w ?? 8, zoom, timeline)}
                  onDragOver={(e, slot) => onZoneDragOver(e, slot, anchorOf)}
                  onDragLeave={() => setActiveSlot(null)}
                  onDrop={(e, slot) => onZoneDrop(e, slot, anchorOf)}
                />
              )}
            </Fragment>
          );
        })}
        {ghosts.map((seg, index) => (
          <SegmentCard
            key={`g-${lineKey}-${seg.of}-${index}`}
            seg={{ ...hydrateSegment(seg, lookup), kind: 'ghost' }}
            baseline={baseline}
            state="planned"
            zoom={zoom}
            timeline={timeline}
            dateLabel="previous slot"
          />
        ))}
        {naiveHere && (
          <div className="tl-decision-marker tl-naive-marker">
            <span>Naive slot</span>
            <b>{Math.round(valueToHours(naiveHere.w ?? 0, timeline))}h exposure</b>
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

function mergeWeeklyStops(planned, stops) {
  const merged = [];
  for (let i = 0; i < (planned ?? []).length; i += 1) {
    merged.push({ ...planned[i], _source: 'plan', _planIndex: i });
  }
  for (let i = 0; i < (stops ?? []).length; i += 1) {
    merged.push({
      ...stops[i],
      _source: 'weeklyStop',
      _stopIndex: i,
      locked: true,
    });
  }
  merged.sort((a, b) => {
    const byStart = Number(a.start ?? 0) - Number(b.start ?? 0);
    if (byStart !== 0) return byStart;
    if (a.kind && !b.kind) return -1;
    if (!a.kind && b.kind) return 1;
    return 0;
  });
  let planSeen = 0;
  return merged.map((seg) => {
    const withSlot = { ...seg, _slotBefore: planSeen };
    if (seg._source === 'plan' && seg.kind !== 'clean' && seg.kind !== 'maint') planSeen += 1;
    return withSlot;
  });
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
function nextStop(planned, timeline) {
  const seg = planned.find((s) => s.kind === 'clean' || s.kind === 'maint');
  if (!seg) return null;
  return { kind: seg.kind, hoursFromNow: Math.max(0, Math.round(valueToHours(seg.start ?? 0, timeline))) };
}

function fmtCountdown(hours) {
  if (hours < 1)  return 'now';
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

/* computeTodayScroll — derive the scrollLeft that pins the NOW divider
   to the left edge of the visible lane body. The planner's default view
   is "what's coming up"; executed history is reference material reached
   by scrolling left. Pure function of the live DOM so we never depend on
   a cached ref that might be stale across re-mounts.
   Returns null when the lane doesn't actually need scrolling. */
function computeTodayScroll(body) {
  if (!body) return null;
  const today = body.querySelector('.tl-today');
  if (!today || body.scrollWidth <= body.clientWidth) return null;
  return Math.max(0, today.offsetLeft);
}

/* normalizeRun — basePlan/executedHistory segments use { of, sku, vol, w }
   while RunDetailModal expects { material, sku, volume, durationHours }.
   Map at the wiring boundary so we don't push shape decisions into either
   the data layer or the modal. Service blocks pass through with their kind. */
function normalizeRun(seg, timeline) {
  if (!seg) return null;
  if (seg.kind === 'clean' || seg.kind === 'maint') {
    return { kind: seg.kind, durationHours: valueToHours(seg.w ?? 0, timeline) };
  }
  return {
    material: seg.of,
    sku: seg.sku,
    volume: seg.vol,
    oee: seg.oee,
    durationHours: valueToHours(seg.w ?? 0, timeline),
    format: seg.format,
  };
}

function Lane({
  lineKey,
  centre,
  baseline,
  executed,
  planned,
  displayPlanned,
  zoom,
  timeline,
  sync,
  primary = false,
  onRunClick = null,
  moving = null,
  onMoveDrop = null,
  lineRules = null,
  events = [],
}) {
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
      const target = computeTodayScroll(body);
      if (target != null) {
        body.scrollLeft = target;
        sync?.broadcast(body);
      }
      setDrift(0);
    };
    place();
    const t = setTimeout(place, 60);
    return () => clearTimeout(t);
  }, [zoom, sync, primary]);

  function handleScroll() {
    const body = bodyRef.current;
    if (!body) return;
    sync?.broadcast(body);
    const target = computeTodayScroll(body);
    if (target == null) { setDrift(0); return; }
    setDrift(Math.abs(body.scrollLeft - target));
  }

  function backToToday() {
    const body = bodyRef.current;
    if (!body) return;
    const target = computeTodayScroll(body);
    if (target == null) return;
    body.scrollLeft = target;
    sync?.broadcast(body);
  }

  const showBack = primary && drift > 40;

  const laneClassName = [
    'tl-lane',
    isMoving && compatible ? 'tl-lane-droptarget' : '',
    isMoving && !compatible ? 'tl-lane-incompat' : '',
    isMoving && isSourceLane ? 'tl-lane-source' : '',
  ].filter(Boolean).join(' ');

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
        <LineRuleChips lineKey={lineKey} lineRules={lineRules} />
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
        <LineEvents events={events} />
        {(() => {
          const stop = nextStop(displayPlanned ?? planned, timeline);
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
        {(() => {
          const execEnd = executedEnd(executed);
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
                timeline={timeline}
                dateLabel={dayRange((seg.start ?? 0) - execEnd, seg.w ?? 0, timeline)}
                onClick={onRunClick ? () => onRunClick({ seg: normalizeRun(seg, timeline), prev: normalizeRun(prev, timeline), next: normalizeRun(next, timeline), lineKey, baseline, state: 'executed' }) : null}
              />
            );
          });
        })()}
        <div className="tl-today" aria-label="today" />
        {/* In moving mode + compatible lane, render a drop zone before
            each segment and one trailing zone at the end. We use simple
            sibling elements (not absolutely positioned) so the lane's
            horizontal flow naturally separates the slots. */}
        {isMoving && compatible && (
          <DropZone
            slotIndex={0}
            active={activeSlot === 0}
            isFirst
            runWidthPx={widthForDuration(moving.run.w ?? 1, zoom, timeline)}
            onDragOver={onZoneDragOver}
            onDragLeave={onZoneDragLeave}
            onDrop={onZoneDrop}
          />
        )}
        {(displayPlanned ?? planned).map((seg, i) => {
          const planIndex = seg._planIndex ?? i;
          const prev = planIndex > 0 ? planned[planIndex - 1] : (executed[executed.length - 1] ?? null);
          const next = planIndex < planned.length - 1 ? planned[planIndex + 1] : null;
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
                timeline={timeline}
                dateLabel={dayRange(seg.start ?? 0, seg.w ?? 0, timeline)}
                onClick={seg.kind === 'clean' || seg.kind === 'maint' ? null : (onRunClick ? () => onRunClick({ seg: normalizeRun(seg, timeline), prev: normalizeRun(prev, timeline), next: normalizeRun(next, timeline), lineKey, baseline, state: 'planned' }) : null)}
              />
              {isMoving && compatible && seg._source === 'plan' && seg.kind !== 'clean' && seg.kind !== 'maint' && (
                <DropZone
                  slotIndex={(seg._planIndex ?? i) + 1}
                  active={activeSlot === (seg._planIndex ?? i) + 1}
                  runWidthPx={widthForDuration(moving.run.w ?? 1, zoom, timeline)}
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

function SegmentCard({ seg, baseline, state, zoom, timeline, dateLabel, onClick = null, ghost = false }) {
  const duration = seg.w ?? 1;
  const durationHours = valueToHours(duration, timeline);
  const widthPx = widthForDuration(duration, zoom, timeline);

  if (seg.kind === 'clean' || seg.kind === 'maint') {
    return (
      <TimelineCard
        kind={seg.kind}
        label={seg.label}
        durationHours={durationHours}
        widthPx={widthPx}
        dateLabel={dateLabel}
      />
    );
  }

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
      dateLabel={dateLabel}
      format={seg.format}
      onClick={ghost ? null : onClick}
      ghost={ghost}
    />
  );
}

function LineRuleChips({ lineKey, lineRules }) {
  const formats = allowedFormats(lineKey, lineRules);
  if (!formats.length) return null;
  return (
    <div className="line-rule-chips" aria-label={`Line ${lineKey} allowed formats`}>
      {formats.map((fmt) => (
        <span key={fmt.key} className="line-rule-chip">{fmt.label}</span>
      ))}
    </div>
  );
}

function LineEvents({ events }) {
  if (!events?.length) return null;
  const stoppages = events.filter((event) => event.type === 'stoppage').length;
  const issues = events.filter((event) => event.type === 'issue').length;
  return (
    <div className="line-event-mini">
      {issues > 0 && <span>{issues} issue{issues > 1 ? 's' : ''}</span>}
      {stoppages > 0 && <span>{stoppages} stop{stoppages > 1 ? 's' : ''}</span>}
    </div>
  );
}

/* DropZone — a target rendered between segments in moving mode. At rest
   shows as a slim dashed bar; when active, expands to the full pixel
   width the moved run would occupy on this lane (so Maria sees the
   actual footprint of where it'd land before she releases). */
function DropZone({ slotIndex, active, isFirst = false, runWidthPx = 96, onDragOver, onDragLeave, onDrop }) {
  return (
    <div
      className={`tl-dropzone${active ? ' tl-dropzone-active' : ''}${isFirst ? ' tl-dropzone-first' : ''}`}
      style={active ? { flexBasis: `${runWidthPx}px` } : undefined}
      onDragOver={(e) => onDragOver(e, slotIndex)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, slotIndex)}
      aria-label={`Drop here at position ${slotIndex}`}
    >
      <div className="tl-dropzone-bar" />
      {active && <div className="tl-dropzone-label">Drop here</div>}
    </div>
  );
}
