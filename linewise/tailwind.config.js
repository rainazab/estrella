/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#f7f6f3',
        surface: '#ffffff',
        'surface-2': '#f1f0ec',
        'surface-3': '#e7e6e0',
        line: '#e0dfd8',
        'line-2': '#c7c6bd',
        ink: '#23231f',
        'ink-2': '#5b5a53',
        'ink-3': '#918f86',
        brand: '#1b3a2e',
        'brand-2': '#2f5d49',
        accent: '#b8732b',
        good: '#3b6d11',
        'good-bg': '#eef4e3',
        'good-line': '#6d8f4a',
        mid: '#8a6410',
        'mid-bg': '#f7efdd',
        'mid-line': '#b89a52',
        bad: '#9a2f2f',
        'bad-bg': '#f7e7e6',
        'bad-line': '#b06b6b',
      },
      borderRadius: { tok: '7px', toklg: '11px' },
      boxShadow: {
        tok: '0 1px 2px rgba(35,35,31,0.04), 0 4px 14px rgba(35,35,31,0.05)',
      },
    },
  },
  plugins: [],
};
