import { useEffect, useRef, useState } from 'react';
import TimelineCard from './TimelineCard.jsx';
import InfoPopover from './InfoPopover.jsx';

/* Timeline — three line lanes (14, 17, 19), each a horizontally-scrolling
   row of TimelineCards. Executed-history cards (faded) flow first, then a
   TODAY divider, then planned cards.

   `seg.w` from plan.json is the run's duration in days; we feed it to
   TimelineCard as `durationHours` so the card's text shows it correctly,
   and we drive horizontal scale with `widthPx = max(168, w * px-per-day)`
   so card width is proportional to duration. */

const LINES = ['14', '17', '19'];

const WIDTH_PER_DAY = { day: 200, week: 90, month: 40 };
const MIN_CARD_WIDTH = { day: 168, week: 80, month: 36 };

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

function dayRange(startOffsetDays, durationDays) {
  const startD = addDays(TODAY, startOffsetDays);
  const endD   = addDays(TODAY, startOffsetDays + durationDays);
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

export default function Timeline({ data, mode = 'default', zoom = 'day' }) {
  /* Scenarios 3-5 will replace these placeholders. */
  if (mode !== 'default') {
    return (
      <div className="tl-placeholder">
        Timeline ({mode} mode) — coming next.
      </div>
    );
  }

  return (
    <div className="tl">
      {LINES.map((lineKey) => (
        <Lane
          key={lineKey}
          lineKey={lineKey}
          centre={data.lineCentre?.[lineKey] ?? 'CF Prat'}
          baseline={data.lineBaseline?.[lineKey]}
          executed={data.executedHistory?.[lineKey] ?? []}
          planned={data.basePlan?.[lineKey] ?? []}
          zoom={zoom}
        />
      ))}
    </div>
  );
}

/* nextStop — first cleaning or maintenance block in the forward plan.
   Returns { kind, hoursFromNow } or null when there's nothing scheduled. */
function nextStop(planned) {
  const seg = planned.find((s) => s.kind === 'clean' || s.kind === 'maint');
  if (!seg) return null;
  return { kind: seg.kind, hoursFromNow: Math.max(0, Math.round((seg.start ?? 0) * 24)) };
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

function Lane({ lineKey, centre, baseline, executed, planned, zoom }) {
  const bodyRef = useRef(null);
  const [drift, setDrift] = useState(0);

  /* On mount and whenever zoom changes, scroll the lane so today is in
     view. Run once immediately and once after a 60ms tick to catch late
     font/layout loads. */
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const place = () => {
      const target = computeTodayScroll(body);
      if (target != null) body.scrollLeft = target;
      setDrift(0);
    };
    place();
    const t = setTimeout(place, 60);
    return () => clearTimeout(t);
  }, [zoom]);

  function handleScroll() {
    const body = bodyRef.current;
    if (!body) return;
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
  }

  const showBack = drift > 40;

  return (
    <div className="tl-lane">
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
        {(() => {
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
        {(() => {
          const execEnd = executedEnd(executed);
          return executed.map((seg, i) => (
            <SegmentCard
              key={`e-${lineKey}-${i}`}
              seg={seg}
              baseline={baseline}
              state="executed"
              zoom={zoom}
              dateLabel={dayRange((seg.start ?? 0) - execEnd, seg.w ?? 0)}
            />
          ));
        })()}
        <div className="tl-today" aria-label="today" />
        {planned.map((seg, i) => (
          <SegmentCard
            key={`p-${lineKey}-${i}`}
            seg={seg}
            baseline={baseline}
            state="planned"
            zoom={zoom}
            dateLabel={dayRange(seg.start ?? 0, seg.w ?? 0)}
          />
        ))}
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

function SegmentCard({ seg, baseline, state, zoom, dateLabel }) {
  const durationDays = seg.w ?? 1;
  const widthPx = Math.max(
    MIN_CARD_WIDTH[zoom] ?? 168,
    Math.round(durationDays * (WIDTH_PER_DAY[zoom] ?? 200)),
  );

  if (seg.kind === 'clean' || seg.kind === 'maint') {
    return (
      <TimelineCard
        kind={seg.kind}
        durationHours={durationDays * 24}
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
      durationHours={durationDays * 24}
      widthPx={widthPx}
      state={state}
      dateLabel={dateLabel}
    />
  );
}
