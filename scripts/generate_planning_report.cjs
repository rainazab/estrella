#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  console.error('Missing playwright. Run with the bundled Codex NODE_PATH or install playwright locally.');
  console.error(error.message);
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'linewise', 'data', 'plan.json');
const PUBLIC_REPORT_DIR = path.join(ROOT, 'linewise', 'public', 'reports');
const OUTPUT_REPORT_DIR = path.join(ROOT, 'data', 'output');
const REPORT_HTML = path.join(PUBLIC_REPORT_DIR, 'planning-report-one-pager.html');
const REPORT_PDF = path.join(PUBLIC_REPORT_DIR, 'planning-report-one-pager.pdf');
const OUTPUT_PDF = path.join(OUTPUT_REPORT_DIR, 'planning-report-one-pager.pdf');

const CHROME_FOR_TESTING = '/Users/abdibedel/.cache/puppeteer/chrome/mac_arm-148.0.7778.97/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const HEADLESS_SHELL = '/Users/abdibedel/.cache/puppeteer/chrome-headless-shell/mac_arm-148.0.7778.97/chrome-headless-shell-mac-arm64/chrome-headless-shell';

function readPlan() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function pickReportData(data) {
  const selectedKey = data.objectives?.oee?.order?.[0] ?? Object.keys(data.recommendations ?? {})[0];
  const selected = data.recommendations[selectedKey];
  const order = data.urgentOrders?.[0] ?? {};
  const alternatives = (data.objectives?.oee?.order ?? [])
    .filter((key) => key !== selectedKey)
    .map((key) => ({ key, rec: data.recommendations[key] }))
    .filter((item) => item.rec)
    .slice(0, 2);

  const windowDays = data.timeline?.views?.month?.daysAhead ?? 35;
  const lines = Object.keys(data.lineCentre ?? {}).map((line) => `L${line}`).join(', ');
  const selectedRuns = Object.values(selected?.plan ?? {})
    .flat()
    .filter((run) => run && run.kind !== 'clean' && run.kind !== 'maint');
  const affectedVolume = selectedRuns.reduce((sum, run) => sum + (Number(run.vol) || 0), 0);

  return {
    selectedKey,
    selected,
    order,
    alternatives,
    planningWindow: `${Math.round(windowDays)}-day window from ${formatDate(data.timeline?.anchorDate)}`,
    lines,
    affectedVolume,
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-GB');
}

function formatDate(value) {
  if (!value) return '24 May';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(date);
}

function shortSku(sku) {
  const raw = String(sku || '').trim();
  if (!raw) return 'Not specified';
  const fmtMatch = raw.match(/(\d{2,3})\s*cl/i);
  const fmt = fmtMatch ? `${fmtMatch[1]}CL` : '';
  const words = raw
    .replace(/[,º°]\S*/g, '')
    .split(/\s+/)
    .filter((word) => word && !/^(L|P|B\d|KR|LC|SH)/i.test(word))
    .slice(0, 2)
    .join(' ');
  return [words || raw.split(/\s+/).slice(0, 2).join(' '), fmt].filter(Boolean).join(' ');
}

function riskRows(selected) {
  const conflicts = countServiceConflicts(selected);
  const rows = [
    {
      label: 'Delivery risk',
      value: selected.deadline === 'on time' ? 'No due-date breach' : selected.deadline,
      tone: selected.deadline === 'on time' ? 'good' : 'warn',
    },
    {
      label: 'Schedule disruption',
      value: selected.ordersMoved === 0 ? 'No downstream orders moved' : `${selected.ordersMoved} orders moved`,
      tone: selected.ordersMoved === 0 ? 'good' : 'warn',
    },
    {
      label: 'Service windows',
      value: conflicts === 0 ? 'No cleaning or maintenance conflict' : `${conflicts} service conflicts`,
      tone: conflicts === 0 ? 'good' : 'bad',
    },
    {
      label: 'Evidence confidence',
      value: `${selected.evidence?.n ?? 0} historical analogues`,
      tone: (selected.evidence?.n ?? 0) >= 5 ? 'good' : 'warn',
    },
  ];
  return rows;
}

function countServiceConflicts(selected) {
  const plan = selected?.plan ?? {};
  let count = 0;
  for (const lane of Object.values(plan)) {
    const services = lane.filter((run) => run.kind === 'clean' || run.kind === 'maint');
    const production = lane.filter((run) => run.kind !== 'clean' && run.kind !== 'maint');
    for (const run of production) {
      const start = Number(run.start) || 0;
      const end = start + (Number(run.w) || 0);
      for (const service of services) {
        const serviceStart = Number(service.start) || 0;
        const serviceEnd = serviceStart + (Number(service.w) || 0);
        if (start < serviceEnd && end > serviceStart) count += 1;
      }
    }
  }
  return count;
}

function buildHtml(data) {
  const report = pickReportData(data);
  const { selected, order } = report;
  const evidence = selected.evidence ?? {};
  const recovery = selected.recovery?.hours ? `${selected.recovery.hours}h` : 'n/a';
  const decision = `Approve the ${selected.line} insertion ${selected.position}: ${selected.oeeDelta} OEE pts, ${selected.deadline}, ${selected.ordersMoved} orders moved.`;
  const generated = '24 May 2026, 17:00 CEST';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Stride Planning Report</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #23231f;
      background: #f6f4ef;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 16mm;
      background: #fbfaf7;
      position: relative;
      overflow: hidden;
    }
    .topline {
      height: 6px;
      background: linear-gradient(90deg, #b6252a 0%, #8f1f25 56%, #b8732b 100%);
      position: absolute;
      inset: 0 0 auto 0;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 18px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .mark {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      background: #b6252a;
      color: #f4f3ee;
      display: grid;
      place-items: center;
      font-weight: 900;
      font-size: 22px;
      letter-spacing: -0.03em;
    }
    .brand b { display: block; font-size: 19px; line-height: 1; }
    .brand span { display: block; color: #6c6a62; font-size: 11px; margin-top: 5px; }
    .status {
      border: 1px solid #dcd8ce;
      color: #b6252a;
      background: #ffffff;
      border-radius: 999px;
      padding: 7px 11px;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      white-space: nowrap;
    }
    h1 {
      font-size: 28px;
      line-height: 1.08;
      margin: 0 0 8px;
      letter-spacing: -0.02em;
    }
    .subtitle {
      color: #5e5b53;
      font-size: 13px;
      line-height: 1.45;
      max-width: 150mm;
      margin: 0 0 18px;
    }
    .decision {
      background: #b6252a;
      color: #f7f2e8;
      border-radius: 12px;
      padding: 15px 17px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 14px;
      align-items: center;
      margin-bottom: 14px;
    }
    .decision small {
      color: #f0d8a0;
      display: block;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-weight: 800;
      font-size: 9.5px;
      margin-bottom: 6px;
    }
    .decision b { font-size: 17px; line-height: 1.35; }
    .decision .stamp {
      border: 1px solid rgba(255,255,255,.24);
      border-radius: 10px;
      padding: 9px 10px;
      min-width: 88px;
      text-align: center;
    }
    .stamp span { display: block; color: #f0d8a0; font-size: 9px; text-transform: uppercase; letter-spacing: .12em; }
    .stamp strong { display: block; font-size: 20px; margin-top: 2px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 9px;
      margin-bottom: 14px;
    }
    .kpi {
      background: #fff;
      border: 1px solid #dedad1;
      border-top: 4px solid #6a8f43;
      border-radius: 10px;
      padding: 12px;
      min-height: 76px;
    }
    .kpi.warn { border-top-color: #f4f3ee; }
    .kpi span {
      display: block;
      color: #858178;
      text-transform: uppercase;
      letter-spacing: .14em;
      font-size: 9.5px;
      font-weight: 800;
      margin-bottom: 9px;
    }
    .kpi b {
      font-size: 24px;
      color: #2f6318;
      line-height: 1;
    }
    .kpi.warn b { color: #8c592c; }
    .two-col {
      display: grid;
      grid-template-columns: 1.06fr .94fr;
      gap: 12px;
      margin-bottom: 12px;
    }
    .card {
      background: #fff;
      border: 1px solid #dedad1;
      border-radius: 12px;
      padding: 14px;
    }
    .card h2 {
      margin: 0 0 11px;
      color: #23231f;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .14em;
    }
    .facts {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 9px;
    }
    .fact {
      border-bottom: 1px solid #ebe7dd;
      padding-bottom: 8px;
      min-height: 44px;
    }
    .fact span {
      display: block;
      color: #77736a;
      font-size: 10px;
      margin-bottom: 3px;
    }
    .fact b { display: block; font-size: 13px; line-height: 1.25; }
    .risk-list {
      display: grid;
      gap: 8px;
    }
    .risk {
      display: grid;
      grid-template-columns: 18px 1fr;
      gap: 8px;
      align-items: start;
      font-size: 12px;
      line-height: 1.35;
    }
    .dot {
      width: 18px;
      height: 18px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      font-size: 11px;
      font-weight: 900;
      background: #e9f0e3;
      color: #2f6318;
    }
    .dot.warn { background: #fbecd9; color: #8c592c; }
    .dot.bad { background: #f9dfdb; color: #9f2f22; }
    .risk b { display: block; font-size: 12px; }
    .risk span { color: #69655d; }
    .alt-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
    }
    .alt-table th {
      text-align: left;
      color: #7c776e;
      text-transform: uppercase;
      letter-spacing: .1em;
      font-size: 9px;
      border-bottom: 1px solid #dedad1;
      padding: 0 0 7px;
    }
    .alt-table td {
      border-bottom: 1px solid #eeeae2;
      padding: 8px 0;
    }
    .alt-table tr:last-child td { border-bottom: 0; }
    .callout {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 9px;
      margin-bottom: 13px;
    }
    .mini {
      background: #f4f1ea;
      border: 1px solid #dedad1;
      border-radius: 10px;
      padding: 11px;
      min-height: 64px;
    }
    .mini span {
      display: block;
      color: #7c776e;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: .12em;
      font-weight: 800;
      margin-bottom: 6px;
    }
    .mini b {
      display: block;
      font-size: 12.5px;
      line-height: 1.3;
    }
    footer {
      position: absolute;
      left: 16mm;
      right: 16mm;
      bottom: 12mm;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: #77736a;
      font-size: 9.5px;
      border-top: 1px solid #dedad1;
      padding-top: 8px;
    }
  </style>
</head>
<body>
  <main class="page">
    <div class="topline"></div>
    <header>
      <div class="brand">
        <div class="mark">S</div>
        <div>
          <b>Stride Planning Brief</b>
          <span>Damm El Prat - Production planning</span>
        </div>
      </div>
      <div class="status">Draft plan - live schedule unchanged</div>
    </header>

    <h1>Operations decision brief</h1>
    <p class="subtitle">One-page summary for Operations, Shift Leadership and Supply Chain review. Generated for attachment outside Stride.</p>

    <section class="decision">
      <div>
        <small>Recommended decision</small>
        <b>${escapeHtml(decision)}</b>
      </div>
      <div class="stamp">
        <span>Priority</span>
        <strong>Approve</strong>
      </div>
    </section>

    <section class="grid" aria-label="Key impact">
      <div class="kpi"><span>OEE impact</span><b>${escapeHtml(selected.oeeDelta)}</b></div>
      <div class="kpi"><span>Due date</span><b>${escapeHtml(selected.deadline)}</b></div>
      <div class="kpi"><span>Orders moved</span><b>${escapeHtml(selected.ordersMoved)}</b></div>
      <div class="kpi warn"><span>Recovery</span><b>${escapeHtml(recovery)}</b></div>
    </section>

    <section class="two-col">
      <div class="card">
        <h2>Planning context</h2>
        <div class="facts">
          <div class="fact"><span>Urgent OF</span><b>${escapeHtml(order.of)}</b></div>
          <div class="fact"><span>Required by</span><b>${escapeHtml(order.due)}</b></div>
          <div class="fact"><span>Volume</span><b>${formatNumber(order.units)} units / ${formatNumber(order.hl)} hl</b></div>
          <div class="fact"><span>Selected slot</span><b>${escapeHtml(selected.line)} ${escapeHtml(selected.position)}</b></div>
          <div class="fact"><span>SKU</span><b>${escapeHtml(shortSku(order.sku))}</b></div>
          <div class="fact"><span>Scope</span><b>${escapeHtml(report.lines)} / ${escapeHtml(report.planningWindow)}</b></div>
        </div>
      </div>
      <div class="card">
        <h2>Risk checks</h2>
        <div class="risk-list">
          ${riskRows(selected).map((row) => `
            <div class="risk">
              <div class="dot ${row.tone === 'good' ? '' : row.tone}">${row.tone === 'good' ? '✓' : '!'}</div>
              <div><b>${escapeHtml(row.label)}</b><span>${escapeHtml(row.value)}</span></div>
            </div>`).join('')}
        </div>
      </div>
    </section>

    <section class="callout">
      <div class="mini"><span>Evidence basis</span><b>${escapeHtml(evidence.n ?? 0)} analogue runs; ${escapeHtml(evidence.analogueMean ?? 'n/a')} mean OEE vs ${escapeHtml(evidence.naiveMean ?? 'n/a')} naive slot.</b></div>
      <div class="mini"><span>Tradeoff accepted</span><b>Optimises OEE while keeping delivery on time and avoiding knock-on moves.</b></div>
      <div class="mini"><span>Report use</span><b>Attach to approval, shift alignment or daily KPI update email.</b></div>
    </section>

    <section class="two-col">
      <div class="card">
        <h2>Alternative options reviewed</h2>
        <table class="alt-table">
          <thead><tr><th>Option</th><th>OEE</th><th>Due</th><th>Moved</th></tr></thead>
          <tbody>
            <tr><td><b>Selected - ${escapeHtml(selected.line)}</b></td><td>${escapeHtml(selected.oeeDelta)}</td><td>${escapeHtml(selected.deadline)}</td><td>${escapeHtml(selected.ordersMoved)}</td></tr>
            ${report.alternatives.map(({ rec }) => `
              <tr><td>${escapeHtml(rec.line)}</td><td>${escapeHtml(rec.oeeDelta)}</td><td>${escapeHtml(rec.deadline)}</td><td>${escapeHtml(rec.ordersMoved)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="card">
        <h2>What is included</h2>
        <div class="risk-list">
          <div class="risk"><div class="dot">✓</div><div><b>Selected draft plan</b><span>Line, slot and urgent order details.</span></div></div>
          <div class="risk"><div class="dot">✓</div><div><b>Key KPIs</b><span>OEE, due date, recovery and disruption impact.</span></div></div>
          <div class="risk"><div class="dot">✓</div><div><b>Decision rationale</b><span>Evidence, tradeoffs and risk checks for manager review.</span></div></div>
        </div>
      </div>
    </section>

    <footer>
      <span>Generated by Maria Rovira - Planner, El Prat - ${generated}</span>
      <span>Stride report ID ST-${escapeHtml(order.of)}-${escapeHtml(report.selectedKey)} - PDF attachment ready</span>
    </footer>
  </main>
</body>
</html>`;
}

async function main() {
  const data = readPlan();
  const html = buildHtml(data);

  fs.mkdirSync(PUBLIC_REPORT_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_HTML, html, 'utf8');

  const executablePath = fs.existsSync(CHROME_FOR_TESTING)
    ? CHROME_FOR_TESTING
    : fs.existsSync(HEADLESS_SHELL)
      ? HEADLESS_SHELL
      : undefined;

  const browser = await chromium.launch({
    headless: true,
    executablePath,
  });
  const page = await browser.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.pdf({
    path: REPORT_PDF,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
  });
  await browser.close();

  fs.copyFileSync(REPORT_PDF, OUTPUT_PDF);
  console.log(`wrote ${REPORT_HTML}`);
  console.log(`wrote ${REPORT_PDF}`);
  console.log(`wrote ${OUTPUT_PDF}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
