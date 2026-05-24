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

/* Line config — each parallel belt in the SVG.
   y-positions spaced 180px apart so the layout fills a 720-tall viewBox. */
const LINES = [
  { key: 'L1', y: 200, sku: 'estrella',  output: 247, color: '#e30613' },
  { key: 'L2', y: 380, sku: 'daura',     output: 189, color: '#c8941a' },
  { key: 'L3', y: 560, sku: 'vollDamm',  output: 163, color: '#1a1a1a' },
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

export default function BrewLoader() {
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

      {/* ============ ANIMATED STAGE ============ */}
      <svg
        className="brew-loader__stage"
        viewBox="0 0 1180 720"
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
        <rect width="1180" height="720" fill="#ffffff" />

        {/* ============ HOPPER (incoming order queue) ============ */}
        <g>
          <text x="140" y="80" textAnchor="middle" fontSize="12" fontWeight="700" letterSpacing="2" fill="#5b5a53">
            ORDER QUEUE
          </text>
          <path
            d="M 70 100 L 210 100 L 185 200 L 95 200 Z"
            fill="#f7f6f3" stroke="#c2c9d4" strokeWidth="1.5"
          />
          <Bottle x={120} y={165} scale={1.0} sku="estrella" className="hopper-bottle hopper-bottle--1" />
          <Bottle x={160} y={165} scale={1.0} sku="daura"    className="hopper-bottle hopper-bottle--2" />
          <Bottle x={140} y={130} scale={1.0} sku="vollDamm" className="hopper-bottle hopper-bottle--3" />
          <rect x="100" y="215" width="80" height="26" rx="13" fill="#e30613" />
          <text x="140" y="232" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff" letterSpacing="0.5">
            247 ORDERS
          </text>
          {/* Curved flowing path from hopper to mascot */}
          <path
            className="flow-path"
            d="M 140 250 Q 140 340 230 400 T 300 440"
            stroke="#5b5a53" strokeWidth="2.5" fill="none"
            strokeDasharray="6 4" strokeLinecap="round" opacity="0.6"
          />
          <path d="M 292 432 L 302 442 L 290 448" stroke="#5b5a53" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
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
            Each bottle starts near the mascot at L2 height (340, 380),
            and the route-* keyframes carry it to its destination line. */}
        {ROUTED.map((b) => (
          <Bottle
            key={b.idx}
            x={340} y={380} scale={1.6} sku={b.sku}
            className={`route-bottle route--${b.idx}`}
          />
        ))}

        {/* ============ MASCOT (the conductor) ============
            Wrapped in a translate so we can shift him as a unit. Internal
            coordinates kept the same as before so animations still aim
            at the right pivot points. */}
        <ellipse className="floor-shadow" cx="340" cy="635" rx="68" ry="8" fill="#0f172a" opacity="0.22" />
        <g transform="translate(0 120)">
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
                const r = 60;
                const cx = 340 + Math.cos(a) * r;
                const cy = 400 + Math.sin(a) * r;
                return <circle key={i} cx={cx} cy={cy} r="7" fill="#a3000d" />;
              })}
              <circle cx="340" cy="400" r="56" fill="url(#capRed)" />
              <circle cx="340" cy="400" r="56" fill="none" stroke="#5a000a" strokeWidth="1" opacity="0.5" />
              <ellipse cx="322" cy="378" rx="20" ry="10" fill="rgba(255,255,255,0.25)" />
              <g transform="translate(340 370)">
                <path d="M 0 -9 L 2.7 -2.7 L 9 -2.7 L 4 0.9 L 6.3 8.1 L 0 3.6 L -6.3 8.1 L -4 0.9 L -9 -2.7 L -2.7 -2.7 Z" fill="#fff" opacity="0.9" />
              </g>
              <ellipse cx="322" cy="402" rx="11" ry="13" fill="#fff" />
              <ellipse cx="358" cy="402" rx="11" ry="13" fill="#fff" />
              <ellipse className="mascot-eye" cx="324" cy="404" rx="5" ry="6" fill="#1a1a1a" />
              <ellipse className="mascot-eye" cx="360" cy="404" rx="5" ry="6" fill="#1a1a1a" />
              <circle cx="326" cy="402" r="1.6" fill="#fff" />
              <circle cx="362" cy="402" r="1.6" fill="#fff" />
              <path d="M 326 424 Q 340 437 354 424" stroke="#3a0008" strokeWidth="3" fill="none" strokeLinecap="round" />
            </g>
            <g className="mascot-arm-left">
              <path d="M 284 415 Q 266 432 277 454" stroke="#e30613" strokeWidth="10" fill="none" strokeLinecap="round" />
              <circle cx="277" cy="456" r="6" fill="#1a1a1a" />
            </g>
            <g className="mascot-arm">
              <path d="M 396 415 Q 414 410 425 393" stroke="#e30613" strokeWidth="10" fill="none" strokeLinecap="round" />
              <circle cx="425" cy="393" r="6" fill="#1a1a1a" />
              <line x1="427" y1="391" x2="475" y2="365" stroke="#1a1a1a" strokeWidth="3.5" strokeLinecap="round" />
              <circle cx="475" cy="365" r="3.5" fill="#e30613" />
            </g>
          </g>
        </g>

        {/* "Conductor" label under mascot */}
        <text x="340" y="680" textAnchor="middle" fontSize="10" fontWeight="700" fill="#918f86" letterSpacing="2">
          PLANNER
        </text>

        {/* ============ CHANGEOVER-AVOIDED FLASH ============
            Appears above L2 in sync with step 3 (OPTIMISING) to show
            the planner caught a wasteful SKU swap.
            Outer <g> = positioning (SVG transform attribute, stable).
            Inner <g> = animation (CSS transform, doesn't fight position). */}
        <g transform="translate(720 320)">
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

    </div>
  );
}
