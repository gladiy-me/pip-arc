/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // digit-yard UI tokens (docs/PIP_VISUAL_SPEC.md §1); same values as the CSS vars in src/index.css
      colors: {
        bg: '#040906',
        panel: '#07120c',
        green: { DEFAULT: '#39ff7a', dim: '#1f9c4c' },
        mint: '#c4ffd8',
        pink: { DEFAULT: '#ff5fb8', soft: '#ffc2e3' },
        ink: '#d9f7e3',
        muted: '#6f9c80',
        warn: '#ffd166',
        line: 'rgba(57,255,122,.16)',
      },
      fontFamily: {
        ui: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        display: ['Silkscreen', '"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
