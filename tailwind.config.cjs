const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx,html,css}'],
  theme: {
    extend: {
      colors: {
        mint: {
          DEFAULT: '#4DBD98',
          50: '#E6F8F2',
          100: '#CCF1E4',
          200: '#A8E6CF',
          300: '#8ADABF',
          400: '#6BCCAC',
          500: '#4DBD98',
          600: '#42A682',
          700: '#37946B',
          800: '#2C7855',
          900: '#205A3F',
        },
        coral: {
          50: '#FFEDEE',
          100: '#FFD1D4',
          200: '#FFB5B9',
          300: '#FF8E93',
          400: '#FF6A6F',
          500: '#F94F55',
        },
      },
      fontFamily: { sans: [...defaultTheme.fontFamily.sans] },
      boxShadow: { glass: '0 8px 32px rgba(0,0,0,.08)' },
      backdropBlur: { xs: '2px' },
    },
  },
  plugins: [
    ({ addUtilities, theme }) =>
      addUtilities(
        {
          '.font-sans': { fontFamily: theme('fontFamily.sans').join(', ') },
          '.font-serif': { fontFamily: theme('fontFamily.serif').join(', ') },
          '.font-mono': { fontFamily: theme('fontFamily.mono').join(', ') },
        },
        { respectPrefix: true },
      ),
  ],
};
