export const FALLBACK_LINE_RULES = {
  '14': {
    line: '14',
    formats: [
      { key: '1/2', label: '50cl', name: 'medio' },
      { key: '1/3', label: '33cl', name: 'tercio' },
    ],
    summary: 'L14 only runs 50cl, 33cl',
  },
  '17': {
    line: '17',
    formats: [{ key: '1/3', label: '33cl', name: 'tercio' }],
    summary: 'L17 only runs 33cl',
  },
  '19': {
    line: '19',
    formats: [
      { key: '1/2', label: '50cl', name: 'medio' },
      { key: '1/3', label: '33cl', name: 'tercio' },
      { key: '2/5', label: '44cl', name: '2/5' },
    ],
    summary: 'L19 only runs 50cl, 33cl, 44cl',
  },
};

const KEY_TO_LABEL = {
  '1/2': '50cl',
  '1/3': '33cl',
  '2/5': '44cl',
};

export function normalizeLineRules(lineRules) {
  const out = {};
  for (const line of ['14', '17', '19']) {
    const rule = lineRules?.[line] ?? FALLBACK_LINE_RULES[line];
    const formats = Array.isArray(rule.formats) && rule.formats.length
      ? rule.formats.map((fmt) => ({
        key: String(fmt.key ?? ''),
        label: String(fmt.label ?? KEY_TO_LABEL[fmt.key] ?? fmt.key ?? ''),
        name: String(fmt.name ?? fmt.label ?? fmt.key ?? ''),
      }))
      : FALLBACK_LINE_RULES[line].formats;
    out[line] = {
      ...FALLBACK_LINE_RULES[line],
      ...rule,
      line,
      formats,
      summary: rule.summary || `${lineLabel(line)} only runs ${formats.map((f) => f.label).join(', ')}`,
    };
  }
  return out;
}

export function formatToKey(format) {
  const text = String(format ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text.includes('50') || text.includes('1/2') || text.includes('medio')) return '1/2';
  if (text.includes('33') || text.includes('1/3') || text.includes('tercio')) return '1/3';
  if (text.includes('44') || text.includes('2/5')) return '2/5';
  return null;
}

export function keyToFormat(key) {
  return KEY_TO_LABEL[key] ?? null;
}

export function allowedFormats(lineKey, lineRules) {
  const rules = normalizeLineRules(lineRules);
  return rules[String(lineKey)]?.formats ?? [];
}

export function isCompatible(lineKey, format, lineRules) {
  const key = formatToKey(format);
  if (!key) return true;
  return allowedFormats(lineKey, lineRules).some((fmt) => fmt.key === key);
}

export function compatibilityReason(lineKey, format, lineRules) {
  const key = formatToKey(format);
  if (!key || isCompatible(lineKey, format, lineRules)) return null;
  const labels = allowedFormats(lineKey, lineRules).map((fmt) => fmt.label).join(' / ');
  return `L${lineKey} only runs ${labels}`;
}

function lineLabel(line) {
  return `L${line}`;
}
