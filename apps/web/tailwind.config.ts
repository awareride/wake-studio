import type { Config } from 'tailwindcss'

export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    // Monorepo: scan module-kit UI classes (ADR-025) so spec-driven controls
    // and the panel generator get Tailwind utilities.
    '../../packages/module-kit/src/**/*.{ts,tsx}',
    // Module web targets (playgrounds etc). Scoped to avoid scanning
    // node_modules / vendor glue.
    '../../packages/modules/*/*/web/**/*.{ts,tsx}',
    '../../packages/modules/*/*/core/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
        },
        // Semantic tokens (light theme) - see index.css for values.
        // Stored as rgb() triples so Tailwind can compose opacity modifiers.
        surface: 'rgb(var(--ws-surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--ws-surface-2) / <alpha-value>)',
        'surface-3': 'rgb(var(--ws-surface-3) / <alpha-value>)',
        'surface-4': 'rgb(var(--ws-surface-4) / <alpha-value>)',
        ink: {
          1: 'rgb(var(--ws-ink-1) / <alpha-value>)',
          2: 'rgb(var(--ws-ink-2) / <alpha-value>)',
          3: 'rgb(var(--ws-ink-3) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--ws-line) / <alpha-value>)',
          2: 'rgb(var(--ws-line-2) / <alpha-value>)',
        },
        success: 'rgb(var(--ws-success) / <alpha-value>)',
        warning: 'rgb(var(--ws-warning) / <alpha-value>)',
        danger: 'rgb(var(--ws-danger) / <alpha-value>)',
      },
    },
  },
  plugins: [],
} satisfies Config
