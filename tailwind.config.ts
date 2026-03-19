import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#f4f1ea',
        paper: 'rgba(255,255,255,0.9)',
        ink: '#131519',
        muted: '#6b7280',
        accent: '#f97316',
        'accent-strong': '#ea580c',
        night: '#16181f',
        'night-soft': 'rgba(22, 24, 31, 0.88)',
        'night-line': 'rgba(255,255,255,0.1)',
      },
      fontFamily: {
        sans: ['"Avenir Next"', '"Segoe UI"', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      keyframes: {
        grid: {
          '0%': { transform: 'translateY(-50%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        grid: 'grid 15s linear infinite',
        'fade-in': 'fade-in 0.4s ease-out',
        shimmer: 'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
