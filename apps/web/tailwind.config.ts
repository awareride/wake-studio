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
        // Radix sky scale (1-12) - https://www.radix-ui.com/colors
        // Roles: 1-5 tints, 6-8 borders/rings, 9-10 accent solid/hover,
        // 11-12 text on light. Stored as rgb() triples for opacity modifiers.
        brand: {
          1: 'rgb(249 254 255 / <alpha-value>)',
          2: 'rgb(241 250 253 / <alpha-value>)',
          3: 'rgb(225 246 253 / <alpha-value>)',
          4: 'rgb(209 240 250 / <alpha-value>)',
          5: 'rgb(190 231 245 / <alpha-value>)',
          6: 'rgb(169 218 237 / <alpha-value>)',
          7: 'rgb(141 202 227 / <alpha-value>)',
          8: 'rgb(96 179 215 / <alpha-value>)',
          9: 'rgb(124 226 254 / <alpha-value>)',
          10: 'rgb(116 218 248 / <alpha-value>)',
          11: 'rgb(0 116 158 / <alpha-value>)',
          12: 'rgb(29 62 86 / <alpha-value>)',
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
