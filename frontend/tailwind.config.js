/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f4f8ff',
          500: '#3758f9',
          700: '#213bbc',
          900: '#101d52',
        },
      },
    },
  },
  plugins: [],
};
