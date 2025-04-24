/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'selector',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../webview-common/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'mustard-gold': '#FFBF0B',
        'slate-gray': '#8BA2AD',
        'charcoal': '#2A3236',
        'night': '#0E1113'
      }
    },
  },
  plugins: [],
};
