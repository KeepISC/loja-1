/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        ink: { DEFAULT: 'rgb(var(--ink) / <alpha-value>)', secondary: 'rgb(var(--ink-secondary) / <alpha-value>)', muted: 'rgb(var(--ink-muted) / <alpha-value>)' },
        line: { DEFAULT: 'rgb(var(--line) / <alpha-value>)', strong: 'rgb(var(--line-strong) / <alpha-value>)' },
        action: { DEFAULT: 'rgb(var(--action) / <alpha-value>)', ink: 'rgb(var(--action-ink) / <alpha-value>)' },
        disabled: 'rgb(var(--disabled) / <alpha-value>)',
        emerald: { 100: 'rgb(var(--success-bg) / <alpha-value>)', 700: 'rgb(var(--success-ink) / <alpha-value>)' },
        red: { 50: 'rgb(var(--danger-bg) / <alpha-value>)', 200: 'rgb(var(--danger-line) / <alpha-value>)', 600: 'rgb(var(--danger-ink) / <alpha-value>)', 700: 'rgb(var(--danger-ink) / <alpha-value>)' },
        amber: { 50: 'rgb(var(--warning-bg) / <alpha-value>)', 100: 'rgb(var(--warning-bg) / <alpha-value>)', 200: 'rgb(var(--warning-line) / <alpha-value>)', 800: 'rgb(var(--warning-ink) / <alpha-value>)', 900: 'rgb(var(--warning-ink) / <alpha-value>)' },
        brand: {
          50: 'rgb(var(--hero-muted) / <alpha-value>)',
          500: 'rgb(var(--accent) / <alpha-value>)',
          600: 'rgb(var(--accent) / <alpha-value>)',
          700: 'rgb(var(--accent-hover) / <alpha-value>)',
          900: 'rgb(var(--ink) / <alpha-value>)',
        },
      },
      borderRadius: { lg: 'var(--radius-control)', xl: 'var(--radius-panel)', '2xl': 'var(--radius-panel)' },
      boxShadow: { sm: 'var(--shadow-panel)', lg: 'var(--shadow-hover)' },
    },
  },
  plugins: [],
};
