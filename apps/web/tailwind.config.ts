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
        // Radix Colors accent scale (1-12) - https://www.radix-ui.com/colors
        // Roles: 1-5 tints, 6-8 borders/rings, 9-10 accent solid/hover,
        // 11-12 text on light. Backed by --ws-brand-N CSS vars which the app
        // syncs to the user's accent theme (Settings -> Accent color), so
        // module-kit rendered panels follow the theme too. rgb() triples for
        // opacity modifiers.
        brand: {
          1: 'rgb(var(--ws-brand-1) / <alpha-value>)',
          2: 'rgb(var(--ws-brand-2) / <alpha-value>)',
          3: 'rgb(var(--ws-brand-3) / <alpha-value>)',
          4: 'rgb(var(--ws-brand-4) / <alpha-value>)',
          5: 'rgb(var(--ws-brand-5) / <alpha-value>)',
          6: 'rgb(var(--ws-brand-6) / <alpha-value>)',
          7: 'rgb(var(--ws-brand-7) / <alpha-value>)',
          8: 'rgb(var(--ws-brand-8) / <alpha-value>)',
          9: 'rgb(var(--ws-brand-9) / <alpha-value>)',
          10: 'rgb(var(--ws-brand-10) / <alpha-value>)',
          11: 'rgb(var(--ws-brand-11) / <alpha-value>)',
          12: 'rgb(var(--ws-brand-12) / <alpha-value>)',
        },
        // Semantic tokens (light theme) - see index.css for values.
        // Stored as rgb() triples so Tailwind can compose opacity modifiers.
        surface: 'rgb(var(--ws-surface) / <alpha-value>)',
        'surface-1': 'rgb(var(--ws-surface-1) / <alpha-value>)',
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
