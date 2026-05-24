import { useState, useEffect } from 'react';
import './BrewLoader.css';

/* BrewLoader v2 — DAMM brewery loading animation.
   What it shows = what LineWise actually does:
     1. Reading orders from the demand book (hopper feeds bottles in)
     2. Routing each SKU to the right line (mascot conducts to L1/L2/L3)
     3. Optimising OEE / minimising changeovers (KPIs tick up below)
   Self-contained: SVG + CSS keyframes, no deps. */

const BOTTLE_PATH = `
  M -7 -34 L -7 -42 Q -7 -46 -4 -46 L 4 -46 Q 7 -46 7 -42 L 7 -34
  C 9 -32 10 -28 10 -22 L 10 28 Q 10 34 4 34 L -4 34 Q -10 34 -10 28 L -10 -22
  C -10 -28 -9 -32 -7 -34 Z
`;

/* SKU palettes — each is a real DAMM brand */
const SKUS = {
  estrella: {
    name: 'Estrella',
    bodyGradient: 'glassEstrella',
    cap: '#e30613', capDeep: '#a3000d',
    labelBg: '#ffffff', labelStripe: '#e30613',
  },
  daura: {
    name: 'Daura',
    bodyGradient: 'glassDaura',
    cap: '#d4a017', capDeep: '#8a6810',
    labelBg: '#fff5dc', labelStripe: '#c8941a',
  },
  vollDamm: {
    name: 'Voll-Damm',
    bodyGradient: 'glassVoll',
    cap: '#1a1a1a', capDeep: '#000',
    labelBg: '#1a1a1a', labelStripe: '#e30613',
  },
};

function Bottle({ x, y, scale = 1.5, sku = 'estrella', className = '' }) {
  const s = SKUS[sku];
  const labelText = s.labelBg === '#1a1a1a' ? '#fff' : '#1a1a1a';
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className={className}>
        <ellipse cx="0" cy="36" rx="13" ry="2" fill="rgba(120,80,30,0.18)" />
        <path d={BOTTLE_PATH} fill={`url(#${s.bodyGradient})`} stroke="#3d2406" strokeWidth="1.2" />
        <path d="M -6 -28 L -6 22 Q -6 26 -3 26 L -3 -28 Z" fill="rgba(255,230,160,0.5)" />
        <rect x="5" y="-20" width="2" height="40" rx="1" fill="rgba(255,220,140,0.35)" />
        {/* cap */}
        <rect x="-7.4" y="-46" width="14.8" height="9" rx="1.8" fill={s.cap} />
        <rect x="-7.4" y="-44" width="14.8" height="1.5" fill="rgba(255,255,255,0.4)" />
        <rect x="-7.4" y="-39" width="14.8" height="2" fill={s.capDeep} opacity="0.5" />
        {/* label */}
        <rect x="-9" y="-12" width="18" height="14" fill={s.labelBg} stroke="#3d2406" strokeWidth="0.4" />
        <rect x="-9" y="-9" width="18" height="1.5" fill={s.labelStripe} />
        <rect x="-9" y="0.5" width="18" height="1.5" fill={s.labelStripe} />
        <circle cx="0" cy="-5" r="1.3" fill={s.labelStripe} />
      </g>
    </g>
  );
}

function DammStar({ size = 24, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M 12 2 L 14.7 9.2 L 22 9.6 L 16.4 14.4 L 18.4 21.6 L 12 17.5 L 5.6 21.6 L 7.6 14.4 L 2 9.6 L 9.3 9.2 Z"
        fill={color}
      />
    </svg>
  );
}

/* Line config — each parallel belt in the SVG */
const LINES = [
  { key: 'L1', y: 210, sku: 'estrella',  output: 247, color: '#e30613' },
  { key: 'L2', y: 320, sku: 'daura',     output: 189, color: '#c8941a' },
  { key: 'L3', y: 430, sku: 'vollDamm',  output: 163, color: '#1a1a1a' },
];

/* In-flight routed bottles — staggered cycles so each line stays busy.
   The route--N class drives the animation and destination. */
const ROUTED = [
  { idx: 1, sku: 'daura' },
  { idx: 2, sku: 'estrella' },
  { idx: 3, sku: 'vollDamm' },
  { idx: 4, sku: 'daura' },
  { idx: 5, sku: 'estrella' },
  { idx: 6, sku: 'vollDamm' },
];

/* Calendar — Mon–Fri × 4 slots per day = 20 production blocks for the week.
   Each block is coloured by the SKU scheduled in that slot. */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const CAL_PLAN = [
  ['est', 'est', 'dau', 'vol'], // Mon
  ['est', 'dau', 'dau', 'vol'], // Tue
  ['dau', 'vol', 'vol', 'est'], // Wed
  ['vol', 'est', 'est', 'dau'], // Thu
  ['est', 'est', 'dau', 'vol'], // Fri
];

/* useTick — single rAF loop returning 0..1 phase across the 6s cycle. */
function useTick(period = 6000) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const loop = (t) => {
      setPhase(((t - start) % period) / period);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [period]);
  return phase;
}

/* interp — animate from→to during the "optimising" window (40%-85% of cycle),
   so the KPIs visibly tick up in sync with step 3. */
function interp(from, to, phase, decimals = 0) {
  let v;
  if (phase < 0.4) v = from;
  else if (phase > 0.85) v = to;
  else {
    const p = (phase - 0.4) / 0.45;
    const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
    v = from + (to - from) * eased;
  }
  return decimals === 0 ? Math.round(v).toString() : v.toFixed(decimals);
}

export default function BrewLoader() {
  const phase = useTick();
  const oee  = interp(87.2, 90.4, phase, 1);
  const co   = interp(47,   31,   phase, 0);
  const ot   = interp(94,   98,   phase, 0);

  return (
    <div className="brew-loader" role="status" aria-live="polite">
      {/* ============ DAMM HEADER ============ */}
      <div className="brew-loader__header">
        <div className="brew-loader__brand">
          <div className="brew-loader__star"><DammStar size={20} /></div>
          <div>
            <div className="brew-loader__wordmark">DAMM</div>
            <div className="brew-loader__subbrand">Cervecera · Est. 1876</div>
          </div>
        </div>
        <div className="brew-loader__title">
          <b>LineWise</b>
          <span>Production Planner</span>
        </div>
      </div>

      {/* ============ STEPPER ============ */}
      <div className="brew-loader__steps">
        <div className="brew-step brew-step--1">
          <div className="brew-step__num">1</div>
          <span className="brew-step__label">READING ORDERS</span>
          <span className="brew-step__sub">247 orders across 3 SKUs</span>
        </div>
        <div className="brew-step brew-step--2">
          <div className="brew-step__num">2</div>
          <span className="brew-step__label">ROUTING TO LINES</span>
          <span className="brew-step__sub">Assigning runs across L1–L3</span>
        </div>
        <div className="brew-step brew-step--3">
          <div className="brew-step__num">3</div>
          <span className="brew-step__label">OPTIMISING OEE</span>
          <span className="brew-step__sub">Minimising changeovers</span>
        </div>
      </div>

      {/* ============ STATUS LINE ============ */}
      <div className="brew-loader__status">
        <div className="brew-loader__status-track">
          <span className="status-msg status-msg--1">Reading <b>247 orders</b> across 12 lines…</span>
          <span className="status-msg status-msg--2">Routing each SKU to a <b>compatible line</b>…</span>
          <span className="status-msg status-msg--3">Projecting <b>OEE +3.2%</b> on candidate plan…</span>
        </div>
      </div>

      {/* ============ CALENDAR STRIP ============ */}
      <div className="brew-loader__calendar">
        <div className="brew-loader__cal-label">
          Schedule
          <b>This week</b>
        </div>
        <div className="brew-loader__cal-grid">
          {CAL_PLAN.map((blocks, dayI) => (
            <div key={dayI} className="cal-day">
              <div className="cal-day__name">{DAYS[dayI]}</div>
              <div className="cal-day__blocks">
                {blocks.map((c, bI) => (
                  <span
                    key={bI}
                    className={`cal-block cal-block--${c}`}
                    style={{ animationDelay: `${(dayI * 4 + bI) * 0.2}s` }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ============ ANIMATED STAGE ============ */}
      <svg
        className="brew-loader__stage"
        viewBox="0 0 1180 560"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          {/* SKU body gradients */}
          <linearGradient id="glassEstrella" x1="0" y1="-46" x2="0" y2="34" gradientUnits="userSpaceOnUse">
            <stop offset="0"    stopColor="#ffc870" />
            <stop offset="0.45" stopColor="#c87a1a" />
            <stop offset="1"    stopColor="#7a4a10" />
          </linearGradient>
          <linearGradient id="glassDaura" x1="0" y1="-46" x2="0" y2="34" gradientUnits="userSpaceOnUse">
            <stop offset="0"    stopColor="#ffe19a" />
            <stop offset="0.45" stopColor="#daa64a" />
            <stop offset="1"    stopColor="#8a6210" />
          </linearGradient>
          <linearGradient id="glassVoll" x1="0" y1="-46" x2="0" y2="34" gradientUnits="userSpaceOnUse">
            <stop offset="0"    stopColor="#b88040" />
            <stop offset="0.45" stopColor="#704010" />
            <stop offset="1"    stopColor="#2a1408" />
          </linearGradient>

          <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0"   stopColor="#c2c9d4" />
            <stop offset="0.5" stopColor="#8893a5" />
            <stop offset="1"   stopColor="#5b6473" />
          </linearGradient>

          <radialGradient id="capRed" cx="0.4" cy="0.35" r="0.7">
            <stop offset="0"   stopColor="#ff5a5a" />
            <stop offset="0.6" stopColor="#e30613" />
            <stop offset="1"   stopColor="#8a000a" />
          </radialGradient>

          <pattern id="beltPattern" x="0" y="0" width="32" height="20" patternUnits="userSpaceOnUse">
            <rect width="32" height="20" fill="#a8b0bd" />
            <rect x="0" y="0"  width="32" height="1.5" fill="#5b6473" />
            <rect x="14" y="1.5" width="4" height="17" fill="#8893a5" />
          </pattern>

          {/* clip paths per line */}
          {LINES.map((line) => (
            <clipPath key={`clip-${line.key}`} id={`beltClip-${line.key}`}>
              <rect x="410" y={line.y + 24} width="640" height="18" rx="2" />
            </clipPath>
          ))}
        </defs>

        {/* WHITE BG */}
        <rect width="1180" height="560" fill="#ffffff" />

        {/* ============ HOPPER (incoming order queue) ============ */}
        <g>
          <text x="140" y="60" textAnchor="middle" fontSize="11" fontWeight="700" letterSpacing="2" fill="#5b5a53">
            ORDER QUEUE
          </text>
          {/* funnel container */}
          <path
            d="M 80 80 L 200 80 L 180 160 L 100 160 Z"
            fill="#f7f6f3" stroke="#c2c9d4" strokeWidth="1.5"
          />
          {/* stacked incoming bottles (visual queue) */}
          <Bottle x={120} y={130} scale={0.85} sku="estrella" className="hopper-bottle hopper-bottle--1" />
          <Bottle x={160} y={130} scale={0.85} sku="daura"    className="hopper-bottle hopper-bottle--2" />
          <Bottle x={140} y={100} scale={0.85} sku="vollDamm" className="hopper-bottle hopper-bottle--3" />
          {/* "247 orders" counter */}
          <rect x="105" y="175" width="70" height="22" rx="11" fill="#e30613" />
          <text x="140" y="190" textAnchor="middle" fontSize="11" fontWeight="800" fill="#fff" letterSpacing="0.5">
            247 ORDERS
          </text>
          {/* Curved flowing path from hopper to mascot's left side */}
          <path
            className="flow-path"
            d="M 140 205 Q 140 280 220 340 T 290 380"
            stroke="#5b5a53" strokeWidth="2.5" fill="none"
            strokeDasharray="6 4" strokeLinecap="round" opacity="0.6"
          />
          {/* arrow head landing at mascot */}
          <path d="M 282 372 L 292 382 L 280 388" stroke="#5b5a53" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
        </g>

        {/* ============ 3 PARALLEL LINES ============ */}
        {LINES.map((line) => (
          <g key={line.key}>
            {/* line label badge — to the LEFT of the mascot (mascot occupies x≈285–395) */}
            <rect x="220" y={line.y - 16} width="64" height="32" rx="6" fill={line.color} />
            <text x="252" y={line.y + 4} textAnchor="middle" fontSize="14" fontWeight="800" fill="#fff" letterSpacing="0.6">
              {line.key}
            </text>
            <text x="252" y={line.y + 30} textAnchor="middle" fontSize="9" fontWeight="700" fill="#5b5a53" letterSpacing="0.5">
              {SKUS[line.sku].name.toUpperCase()}
            </text>

            {/* belt — starts after the mascot */}
            <rect x="410" y={line.y + 20} width="640" height="26" rx="3" fill="url(#steel)" />
            <g clipPath={`url(#beltClip-${line.key})`}>
              <rect className="belt-tread" x="378" y={line.y + 24} width="700" height="18" fill="url(#beltPattern)" />
            </g>

            {/* output collector on the right */}
            <rect x="1060" y={line.y - 14} width="100" height="56" rx="8" fill="#f7f6f3" stroke={line.color} strokeWidth="1.5" />
            <text x="1110" y={line.y - 2} textAnchor="middle" fontSize="9" fontWeight="700" fill={line.color} letterSpacing="1">
              SCHEDULED
            </text>
            <text className={`out-count out-count--${LINES.indexOf(line) + 1}`}
              x="1110" y={line.y + 22} textAnchor="middle" fontSize="20" fontWeight="800">
              {line.output}
            </text>
            <text x="1110" y={line.y + 36} textAnchor="middle" fontSize="9" fontWeight="600" fill="#918f86" letterSpacing="0.5">
              runs
            </text>
          </g>
        ))}

        {/* ============ ROUTING BOTTLES (in flight) ============
            Each bottle starts near the mascot (340, 320) and the route-*
            keyframes carry it to its destination line + output. */}
        {ROUTED.map((b) => (
          <Bottle
            key={b.idx}
            x={340} y={320} scale={1.4} sku={b.sku}
            className={`route-bottle route--${b.idx}`}
          />
        ))}

        {/* ============ MASCOT (the conductor) ============ */}
        {/* shadow under the mascot, pulses with hop */}
        <ellipse className="floor-shadow" cx="340" cy="515" rx="58" ry="6" fill="#0f172a" opacity="0.22" />
        <g className="mascot">
          <g className="mascot-leg mascot-leg--l">
            <rect x="320" y={460} width="10" height="30" rx="4" fill="#e30613" />
            <ellipse cx="325" cy="495" rx="14" ry="6" fill="#1a1a1a" />
          </g>
          <g className="mascot-leg mascot-leg--r">
            <rect x="350" y={460} width="10" height="30" rx="4" fill="#e30613" />
            <ellipse cx="355" cy="495" rx="14" ry="6" fill="#1a1a1a" />
          </g>
          <g className="mascot-body">
            {Array.from({ length: 14 }).map((_, i) => {
              const a = (i / 14) * Math.PI * 2 - Math.PI / 2;
              const r = 55;
              const cx = 340 + Math.cos(a) * r;
              const cy = 400 + Math.sin(a) * r;
              return <circle key={i} cx={cx} cy={cy} r="6" fill="#a3000d" />;
            })}
            <circle cx="340" cy="400" r="52" fill="url(#capRed)" />
            <circle cx="340" cy="400" r="52" fill="none" stroke="#5a000a" strokeWidth="1" opacity="0.5" />
            <ellipse cx="322" cy="378" rx="18" ry="9" fill="rgba(255,255,255,0.25)" />
            <g transform="translate(340 370)">
              <path d="M 0 -8 L 2.4 -2.4 L 8 -2.4 L 3.6 0.8 L 5.6 7.2 L 0 3.2 L -5.6 7.2 L -3.6 0.8 L -8 -2.4 L -2.4 -2.4 Z" fill="#fff" opacity="0.9" />
            </g>
            <ellipse cx="322" cy="402" rx="10" ry="12" fill="#fff" />
            <ellipse cx="358" cy="402" rx="10" ry="12" fill="#fff" />
            <ellipse className="mascot-eye" cx="324" cy="404" rx="4.5" ry="5.5" fill="#1a1a1a" />
            <ellipse className="mascot-eye" cx="360" cy="404" rx="4.5" ry="5.5" fill="#1a1a1a" />
            <circle cx="326" cy="402" r="1.5" fill="#fff" />
            <circle cx="362" cy="402" r="1.5" fill="#fff" />
            <path d="M 327 422 Q 340 434 353 422" stroke="#3a0008" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          </g>
          {/* Left arm */}
          <g className="mascot-arm-left">
            <path d="M 286 415 Q 270 430 280 450" stroke="#e30613" strokeWidth="9" fill="none" strokeLinecap="round" />
            <circle cx="280" cy="452" r="5.5" fill="#1a1a1a" />
          </g>
          {/* Right arm with baton — points to each line in sequence */}
          <g className="mascot-arm">
            <path d="M 394 415 Q 410 410 420 395" stroke="#e30613" strokeWidth="9" fill="none" strokeLinecap="round" />
            <circle cx="420" cy="394" r="5.5" fill="#1a1a1a" />
            <line x1="422" y1="392" x2="465" y2="370" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round" />
            <circle cx="465" cy="370" r="3" fill="#e30613" />
          </g>
        </g>

        {/* "Conductor" label under mascot */}
        <text x="340" y="540" textAnchor="middle" fontSize="9" fontWeight="700" fill="#918f86" letterSpacing="2">
          PLANNER
        </text>

        {/* ============ CHANGEOVER-AVOIDED FLASH ============
            Appears above L2 in sync with step 3 (OPTIMISING) to show
            the planner caught a wasteful SKU swap.
            Outer <g> = positioning (SVG transform attribute, stable).
            Inner <g> = animation (CSS transform, doesn't fight position). */}
        <g transform="translate(720 280)">
          <g className="changeover-flash">
            <rect x="-72" y="-18" width="144" height="36" rx="18" fill="#fff" stroke="#1b8a4e" strokeWidth="1.5" />
            {/* check icon */}
            <circle cx="-54" cy="0" r="11" fill="#1b8a4e" />
            <path d="M -59 0 L -55 4 L -49 -3" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <text x="10" y="-2" textAnchor="middle" fontSize="9" fontWeight="800" fill="#1b8a4e" letterSpacing="0.6">
              CHANGEOVER
            </text>
            <text x="10" y="10" textAnchor="middle" fontSize="9" fontWeight="800" fill="#1b8a4e" letterSpacing="0.6">
              AVOIDED · −12 min
            </text>
            {/* tail pointing at L2 */}
            <path d="M -20 18 L -10 26 L 0 18 Z" fill="#fff" stroke="#1b8a4e" strokeWidth="1.5" />
          </g>
        </g>
      </svg>

      {/* ============ KPI COUNTER ROW (live-ticking values) ============ */}
      <div className="brew-loader__kpis">
        <div className="kpi kpi--1">
          <span className="kpi__label">OEE</span>
          <div className="kpi__values">
            <span className="kpi__before">87.2%</span>
            <span className="kpi__arrow">→</span>
            <span className="kpi__after kpi__after--good">{oee}%</span>
          </div>
          <span className="kpi__delta">+3.2 pts</span>
        </div>
        <div className="kpi kpi--2">
          <span className="kpi__label">Changeovers / wk</span>
          <div className="kpi__values">
            <span className="kpi__before">47</span>
            <span className="kpi__arrow">→</span>
            <span className="kpi__after kpi__after--good">{co}</span>
          </div>
          <span className="kpi__delta">−34%</span>
        </div>
        <div className="kpi kpi--3">
          <span className="kpi__label">On-time delivery</span>
          <div className="kpi__values">
            <span className="kpi__before">94%</span>
            <span className="kpi__arrow">→</span>
            <span className="kpi__after kpi__after--good">{ot}%</span>
          </div>
          <span className="kpi__delta">+4 pts</span>
        </div>
      </div>
    </div>
  );
}
