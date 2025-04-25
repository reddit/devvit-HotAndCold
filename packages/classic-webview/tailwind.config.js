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
      screens: {
        'xs': '322px',    // Minimum width
        'sm': '400px',    // Small breakpoint
        'md': '500px',    // Medium breakpoint
        'lg': '600px',    // Large breakpoint
        'xl': '678px',    // Maximum width
      },
    },
  },
  plugins: [],
};
