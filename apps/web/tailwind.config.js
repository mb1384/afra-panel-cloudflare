/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Vazirmatn', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // هویت بصری افرا: سبز افرا + خاکستری گرم
        afra: {
          50: '#eefbf3',
          100: '#d6f5e2',
          200: '#b0eac9',
          300: '#7dd9a8',
          400: '#48c083',
          500: '#22a568',
          600: '#158554',
          700: '#126a45',
          800: '#125439',
          900: '#104630',
          950: '#04271b',
        },
        ink: {
          50: '#f7f7f8',
          100: '#eeeef0',
          200: '#d9d9de',
          300: '#b8b8c0',
          400: '#91919d',
          500: '#737382',
          600: '#5c5c69',
          700: '#4b4b55',
          800: '#3f3f47',
          900: '#27272c',
          950: '#18181b',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.04), 0 4px 16px rgba(16,24,40,0.06)',
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
    },
  },
  plugins: [],
};
