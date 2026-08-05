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
      },
    },
  },
  plugins: [],
} satisfies Config
