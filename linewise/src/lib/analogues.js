/* Expand evidence.analogues (3 sample entries) into the full N-row historical
   list implied by evidence.n. Output is deterministic — same rec key always
   yields the same list — so re-opening the modal doesn't reshuffle rows.

   The 3 sample analogues from plan.json are kept verbatim as the first rows
   (they're the ones cited in the recommendation reason). The remaining rows
   are synthesised from the recommendation's own line/breakdown profile. */

const SKU_FOR_OF = {
  ED05LTNN: 'Estrella Damm · lata 50cl',
  ED13LTNN: 'Estrella Damm · lata 33cl',
  VO13LTMP: 'Voll-Damm · lata 33cl',
  FDT13LT:  'Free Damm · lata 33cl',
  AM05LTST: 'A. K. Damm · lata 50cl',
};

const OF_POOL = Object.keys(SKU_FOR_OF);

const TYPE_LABELS = {
  'same-envase':  'Same envase',
  'brand-change': 'Brand change',
  'brand':        'Brand change',
  'familia':      'Family change',
  'pack-size':    'Pack-size change',
  'cip-clean':    'CIP cleaning',
};

/* mulberry32 — tiny seeded PRNG; deterministic across browsers. */
function rng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromKey(key) {
  let h = 2166136261;
  const s = String(key);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function formatDate(monthIdx, day) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(day).padStart(2, '0')} ${months[monthIdx]} 2025`;
}

/* Weighted type pick driven by the breakdown shares. Same-envase shows up
   more often when envase-change penalty is "lo" (i.e. most history rows
   were same-envase). */
function typeWeights(breakdown) {
  const w = { 'same-envase': 0.45, 'brand-change': 0.2, 'pack-size': 0.2, 'cip-clean': 0.15 };
  for (const b of breakdown || []) {
    if (b.name === 'Envase change' && b.band === 'lo') w['same-envase'] += 0.15;
    if (b.name === 'Brand change'   && b.band === 'hi') w['brand-change'] += 0.1;
    if (b.name === 'Pack-size change' && b.band === 'hi') w['pack-size'] += 0.05;
    if (b.name === 'Cleaning / CIP'   && b.band === 'hi') w['cip-clean'] += 0.05;
  }
  return w;
}

function weightedPick(rand, weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (const [k, w] of Object.entries(weights)) {
    if ((r -= w) <= 0) return k;
  }
  return Object.keys(weights)[0];
}

/* Sample OEE for a synthesised row by combining the recommendation's own
   analogueMean (the cluster center the strip must honestly reflect) with a
   small per-type lift/drag. This is the load-bearing change for the honesty
   story: without it, all three lines' clusters land in the same band and the
   distribution strip falsely shows "confident" for every recommendation. */
function oeeForType(rand, type, mean) {
  const lift = {
    'same-envase':   0.020,
    'brand-change': -0.025,
    'brand':        -0.025,
    'familia':      -0.020,
    'pack-size':    -0.010,
    'cip-clean':    -0.040,
  };
  /* Box-Muller-ish noise around the cluster center. std=0.030 gives a
     visible spread without making outliers dominate the strip. */
  const u1 = Math.max(1e-9, rand());
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const v = mean + (lift[type] ?? 0) + z * 0.030;
  return Math.min(0.72, Math.max(0.35, v)).toFixed(2);
}

/* Build the full N-row index for one recommendation. */
export function buildAnalogueIndex(recKey, evidence) {
  const n = evidence?.n || 0;
  const samples = evidence?.analogues || [];
  if (!n) return [];

  const rand = rng(seedFromKey(recKey));
  const weights = typeWeights(evidence?.breakdown);
  const baseLine = String(recKey);
  const otherLines = ['14', '17', '19'].filter((l) => l !== baseLine);
  const mean = parseFloat(evidence?.analogueMean ?? '0.55');

  const rows = samples.map((a) => ({
    of: a.of,
    sku: SKU_FOR_OF[a.of] || '—',
    date: a.date,
    line: String(a.line),
    type: a.type,
    typeLabel: TYPE_LABELS[a.type] || a.type,
    oee: a.oee,
    sample: true,
  }));

  for (let i = rows.length; i < n; i++) {
    const type = weightedPick(rand, weights);
    /* 60% of synthesised rows on the recommended line; rest split across siblings */
    const line = rand() < 0.6 ? baseLine : pick(rand, otherLines);
    const monthIdx = Math.floor(rand() * 11); // Jan–Nov (2025 still in progress)
    const day = 1 + Math.floor(rand() * 27);
    const ofCode = pick(rand, OF_POOL);
    /* synthesised order numbers look like 00XXXX */
    const orderNum = 4000 + Math.floor(rand() * 1800);
    rows.push({
      of: `00${orderNum}`,
      ofCode,
      sku: SKU_FOR_OF[ofCode],
      date: formatDate(monthIdx, day),
      line,
      type,
      typeLabel: TYPE_LABELS[type] || type,
      oee: oeeForType(rand, type, mean),
      sample: false,
    });
  }

  /* Sort chronologically (most recent first) but keep samples pinned at the top
     since they're the "exemplars" cited in the recommendation. */
  const sorted = rows.slice(samples.length).sort((a, b) => parseDate(b.date) - parseDate(a.date));
  return [...rows.slice(0, samples.length), ...sorted];
}

function parseDate(d) {
  const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  const [day, mon, yr] = d.split(' ');
  return new Date(Number(yr), months[mon] || 0, Number(day)).getTime();
}

export { TYPE_LABELS };

/* Classify a recommendation's evidence into one of four verdicts.
   Priority: a negative gain wins (the option is genuinely worse), then thin n
   (sample size too small for the average to mean much), then within-spread
   (gain is real but the naive value sits inside the analogue cluster, so the
   prediction isn't clearly distinguishable from noise), then confident.

   `rows` is the full analogue index for the rec (from buildAnalogueIndex);
   we use it to derive the actual quantiles rather than re-asserting from the
   summary stats — the strip should reflect what's plotted, not what's stated. */
export function evidenceVerdict(rec, rows, thinThreshold = 20) {
  const evidence = rec.evidence;
  const gainRaw = String(evidence.gain).replace('−', '-').replace('+', '');
  const gain = parseFloat(gainRaw);
  const n = evidence.n;
  const naive = parseFloat(evidence.naiveMean);

  if (gain < 0) {
    return {
      kind: 'worse',
      tone: 'bad',
      headline: 'This option averages below the naive slot.',
      detail: `Across ${n} historical analogues, the mean OEE was ${evidence.analogueMean} — ${Math.abs(gain).toFixed(1)} pts below the naive slot's ${evidence.naiveMean}. Don't override on this evidence.`,
      thinN: n < thinThreshold,
    };
  }

  if (n < thinThreshold) {
    return {
      kind: 'thin',
      tone: 'warn',
      headline: `Thin evidence — only ${n} analogues.`,
      detail: `The mean ${evidence.analogueMean} reflects a small sample. Treat the gain as a guide, not a forecast.`,
      thinN: true,
    };
  }

  /* Where does the naive value sit in the analogue distribution? */
  const oees = rows.map((r) => parseFloat(r.oee)).sort((a, b) => a - b);
  const rank = oees.filter((v) => v < naive).length / oees.length;
  if (rank >= 0.25 && rank <= 0.75) {
    return {
      kind: 'within-spread',
      tone: 'warn',
      headline: 'Mean is within the analogue spread.',
      detail: `The naive value ${evidence.naiveMean} sits inside the middle 50% of the ${n} analogues. The +${gain.toFixed(1)} gain is real on average, but a single run may not clearly outperform the naive slot.`,
      thinN: false,
    };
  }

  return {
    kind: 'confident',
    tone: 'good',
    headline: `${n} analogues cluster above the naive slot.`,
    detail: `Mean ${evidence.analogueMean} sits clearly above the naive ${evidence.naiveMean}. The +${gain.toFixed(1)} gain is well supported by the evidence.`,
    thinN: false,
  };
}
