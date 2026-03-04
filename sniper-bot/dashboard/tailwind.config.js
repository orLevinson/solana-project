/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0f',
        panel: '#151520',
        primary: '#4ade80',
        danger: '#ef4444',
        textMain: '#f8fafc',
        textMuted: '#94a3b8'
      }
    },
  },
  plugins: [],
}
