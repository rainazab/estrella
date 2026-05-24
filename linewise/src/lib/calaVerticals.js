import { createElement } from 'react';
import { CloudRain, Scale, TrendingUp, Wheat } from 'lucide-react';

export const CALA_VERTICALS = {
  agriculture: {
    id: 'agriculture',
    name: 'Agriculture',
    shortLabel: 'AGRI',
    emoji: '🌾',
    Icon: Wheat,
    accentClass: 'cala-agri',
    accent: '#c47a1f',
  },
  finance: {
    id: 'finance',
    name: 'Finance',
    shortLabel: 'FIN',
    emoji: '📈',
    Icon: TrendingUp,
    accentClass: 'cala-fin',
    accent: '#0284c7',
  },
  regulatory: {
    id: 'regulatory',
    name: 'Regulatory',
    shortLabel: 'REG',
    emoji: '⚖️',
    Icon: Scale,
    accentClass: 'cala-reg',
    accent: '#e11d48',
  },
  weather: {
    id: 'weather',
    name: 'Weather',
    shortLabel: 'WX',
    emoji: '🌦️',
    Icon: CloudRain,
    accentClass: 'cala-wx',
    accent: '#7c3aed',
  },
};

export function getCalaVertical(vertical) {
  return CALA_VERTICALS[vertical] ?? CALA_VERTICALS.agriculture;
}

export function CalaVerticalIcon({ vertical, size = 14, strokeWidth = 2.2, className = '' }) {
  const meta = getCalaVertical(vertical);
  const Icon = meta.Icon;
  return createElement(Icon, {
    className,
    size,
    strokeWidth,
    'aria-hidden': 'true',
  });
}
