const now = '2026-05-24T09:40:00+02:00';

export const worldSignals = [
  {
    id: 'sig-barley-futures',
    vertical: 'agriculture',
    headline: 'EU malting barley futures jumped',
    value: 'EUR 238/t',
    delta: '+12%',
    severity: 'high',
    sourceName: 'Euronext MATIF',
    sourceUrl: 'https://live.euronext.com/en/product/commodities-futures/EBM-DPAR',
    fetchedAt: now,
    affects: { lines: ['14', '17'], ofs: ['ED13LTNN', 'FDT13LT'], materials: ['barley', 'malt'] },
  },
  {
    id: 'sig-hops-crop',
    vertical: 'agriculture',
    headline: 'Hallertau aroma hop outlook tightened',
    value: '91% normal yield',
    delta: '-6%',
    severity: 'medium',
    sourceName: 'IHGC',
    sourceUrl: 'https://www.ihgc.org/',
    fetchedAt: '2026-05-24T08:55:00+02:00',
    affects: { lines: ['14'], ofs: ['VO13LTMP'], materials: ['hops'] },
  },
  {
    id: 'sig-aluminum-premium',
    vertical: 'finance',
    headline: 'Aluminium can sheet premium rose',
    value: 'EUR 2,218/t',
    delta: '+4.8%',
    severity: 'high',
    sourceName: 'LME',
    sourceUrl: 'https://www.lme.com/en/metals/non-ferrous/lme-aluminium',
    fetchedAt: '2026-05-24T09:30:00+02:00',
    affects: { lines: ['14', '17', '19'], ofs: ['ED13LTNN', 'ED05LTNN'], materials: ['can', 'lata'] },
  },
  {
    id: 'sig-eur-usd',
    vertical: 'finance',
    headline: 'EUR/USD moved against import cover',
    value: '1.079',
    delta: '-0.7%',
    severity: 'medium',
    sourceName: 'ECB',
    sourceUrl: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html',
    fetchedAt: '2026-05-24T09:05:00+02:00',
    affects: { lines: ['17'], ofs: ['AM05LTST'], materials: ['imported malt'] },
  },
  {
    id: 'sig-excise-window',
    vertical: 'regulatory',
    headline: 'Excise filing window closes earlier',
    value: 'May 29',
    delta: '-1 day',
    severity: 'high',
    sourceName: 'Agencia Tributaria',
    sourceUrl: 'https://sede.agenciatributaria.gob.es/',
    fetchedAt: '2026-05-24T07:40:00+02:00',
    affects: { lines: ['14'], ofs: ['ED13LTNN', 'ED12LTW'], materials: ['finished goods'] },
  },
  {
    id: 'sig-packaging-label',
    vertical: 'regulatory',
    headline: 'Deposit label notice enters review',
    value: 'Catalonia',
    delta: 'draft',
    severity: 'low',
    sourceName: 'DOGC',
    sourceUrl: 'https://dogc.gencat.cat/',
    fetchedAt: '2026-05-24T06:50:00+02:00',
    affects: { lines: ['19'], ofs: ['ED05LTNN'], materials: ['labels'] },
  },
  {
    id: 'sig-port-wind',
    vertical: 'weather',
    headline: 'Port wind advisory may slow inbound cans',
    value: '42 km/h',
    delta: '+18 km/h',
    severity: 'high',
    sourceName: 'Meteocat',
    sourceUrl: 'https://www.meteo.cat/',
    fetchedAt: '2026-05-24T09:15:00+02:00',
    affects: { lines: ['19'], ofs: ['ED05LTNN'], materials: ['cans', 'aluminium'] },
  },
  {
    id: 'sig-heat-prat',
    vertical: 'weather',
    headline: 'El Prat afternoon heat risk increased',
    value: '31 C',
    delta: '+4 C',
    severity: 'medium',
    sourceName: 'AEMET',
    sourceUrl: 'https://www.aemet.es/',
    fetchedAt: '2026-05-24T08:20:00+02:00',
    affects: { lines: ['17'], ofs: ['AM05LTST'], materials: ['cooling'] },
  },
  {
    id: 'sig-co2-spot',
    vertical: 'finance',
    headline: 'Food-grade CO2 spot quote firmed',
    value: 'EUR 188/t',
    delta: '+3.1%',
    severity: 'medium',
    sourceName: 'ICIS',
    sourceUrl: 'https://www.icis.com/',
    fetchedAt: '2026-05-24T09:00:00+02:00',
    affects: { lines: ['14', '19'], ofs: ['ED13LTNN', 'ED05LTNN'], materials: ['carbonation'] },
  },
  {
    id: 'sig-water-restriction',
    vertical: 'regulatory',
    headline: 'Industrial water restriction remains watchlisted',
    value: 'pre-alert',
    delta: 'unchanged',
    severity: 'medium',
    sourceName: 'ACA',
    sourceUrl: 'https://aca.gencat.cat/',
    fetchedAt: '2026-05-24T08:05:00+02:00',
    affects: { lines: ['14', '17', '19'], ofs: [], materials: ['cip', 'cleaning'] },
  },
  {
    id: 'sig-rail-strike',
    vertical: 'regulatory',
    headline: 'Rail labor notice affects Tarragona corridor',
    value: '48h notice',
    delta: 'new',
    severity: 'low',
    sourceName: 'MITMA',
    sourceUrl: 'https://www.transportes.gob.es/',
    fetchedAt: '2026-05-24T06:35:00+02:00',
    affects: { lines: ['17'], ofs: ['FDT13LT'], materials: ['outbound pallets'] },
  },
  {
    id: 'sig-rain-front',
    vertical: 'weather',
    headline: 'Rain front clears evening loading bay',
    value: '18:00',
    delta: 'on track',
    severity: 'low',
    sourceName: 'Meteocat',
    sourceUrl: 'https://www.meteo.cat/',
    fetchedAt: '2026-05-24T07:55:00+02:00',
    affects: { lines: ['14'], ofs: ['VO13LTMP'], materials: ['dispatch'] },
  },
];

const citationText = {
  'sig-barley-futures': 'Malting barley inputs are a cost driver for the 33cl lager slate currently planned on L14 and L17.',
  'sig-hops-crop': 'Hop availability is a secondary constraint for the Voll-Damm run sequence.',
  'sig-aluminum-premium': 'Can sheet price movement increases the cost sensitivity of large lata runs.',
  'sig-eur-usd': 'Imported malt cover moved against the purchase plan for AM05LTST.',
  'sig-excise-window': 'Earlier excise filing pressure makes ED13LTNN and ED12LTW timing more sensitive.',
  'sig-packaging-label': 'Label notice is low urgency but relevant to 50cl packaging plans.',
  'sig-port-wind': 'Inbound can arrivals to the port have elevated delay risk during the next load window.',
  'sig-heat-prat': 'Afternoon heat increases cooling load risk on long continuous runs.',
  'sig-co2-spot': 'CO2 spot movement affects carbonation-heavy beer runs.',
  'sig-water-restriction': 'Water watch status is relevant to CIP-heavy reshuffles.',
  'sig-rail-strike': 'Rail labor notice can affect outbound pallet flow for the Tarragona corridor.',
  'sig-rain-front': 'Weather clears before evening dispatch, lowering loading-bay risk.',
};

export function signalToCitation(signal) {
  return {
    id: `cite-${signal.id}`,
    signalId: signal.id,
    vertical: signal.vertical,
    headline: signal.headline,
    value: signal.value,
    delta: signal.delta,
    severity: signal.severity,
    sourceName: signal.sourceName,
    sourceUrl: signal.sourceUrl,
    fetchedAt: signal.fetchedAt,
    fact: citationText[signal.id] ?? signal.headline,
    lineage: [
      `Cala ${signal.vertical} watcher`,
      signal.sourceName,
      'Stride mock resolver',
    ],
    affects: signal.affects,
  };
}

const byId = Object.fromEntries(worldSignals.map((signal) => [signal.id, signalToCitation(signal)]));
const pick = (...ids) => ids.map((id) => byId[id]).filter(Boolean);

export const citationsByKey = {
  ED13LTNN: pick('sig-barley-futures', 'sig-aluminum-premium', 'sig-excise-window'),
  FDT13LT: pick('sig-barley-futures', 'sig-rail-strike'),
  VO13LTMP: pick('sig-hops-crop', 'sig-rain-front'),
  ED05LTNN: pick('sig-aluminum-premium', 'sig-port-wind', 'sig-packaging-label'),
  ED12LTW: pick('sig-excise-window'),
  AM05LTST: pick('sig-eur-usd', 'sig-heat-prat'),
  'line-14': pick('sig-barley-futures', 'sig-excise-window', 'sig-water-restriction'),
  'line-17': pick('sig-barley-futures', 'sig-eur-usd', 'sig-heat-prat'),
  'line-19': pick('sig-aluminum-premium', 'sig-port-wind', 'sig-water-restriction'),
  'rec-14': pick('sig-barley-futures', 'sig-excise-window', 'sig-co2-spot'),
  'rec-17': pick('sig-eur-usd', 'sig-heat-prat', 'sig-rail-strike'),
  'rec-19': pick('sig-aluminum-premium', 'sig-port-wind', 'sig-packaging-label'),
  'move-throughput': pick('sig-water-restriction', 'sig-heat-prat'),
  'move-cost': pick('sig-aluminum-premium', 'sig-co2-spot'),
};

export function getCitationsForKey(key) {
  return citationsByKey[key] ?? [];
}

export function getCitationsForKeys(keys = []) {
  const seen = new Set();
  return keys.flatMap((key) => getCitationsForKey(key)).filter((citation) => {
    if (seen.has(citation.id)) return false;
    seen.add(citation.id);
    return true;
  });
}
