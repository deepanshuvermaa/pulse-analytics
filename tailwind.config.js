/** @type {import('tailwindcss').Config} */
export default {
  content: ['./client/index.html', './client/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        meadow: { 50: '#f0f7f1', 100: '#dceede', 200: '#b8ddb9', 300: '#85c488', 400: '#5aab5f', 500: '#3d8b42', 600: '#2d6e32', 700: '#255a2a', 800: '#1f4823', 900: '#1a3b1e', 950: '#0d2011' },
        forest: { DEFAULT: '#1f2a1d', light: '#2d3a2a', muted: '#4b5b47' },
        sage: { DEFAULT: '#85AB8B', light: '#a8c5ad' },
      },
      fontFamily: {
        display: ['"Neue Haas Grotesk Display Pro 55 Roman"', '"Neue Haas Grotesk Text Pro"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
