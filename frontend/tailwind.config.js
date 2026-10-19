// Loaded explicitly by index.css through Tailwind 4's @config compatibility API.
export default {
  theme: {
    extend: {
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'sans-serif', '"Apple Color Emoji"', '"Segoe UI Emoji"', '"Segoe UI Symbol"', '"Noto Color Emoji"'],
      },
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
      borderRadius: { DEFAULT: '0.25rem', sm: '0.125rem', lg: 'var(--radius-control)', xl: 'var(--radius-panel)', '2xl': 'var(--radius-panel)' },
      boxShadow: { DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)', sm: 'var(--shadow-panel)', lg: 'var(--shadow-hover)' },
    },
  },
  plugins: [],
};
