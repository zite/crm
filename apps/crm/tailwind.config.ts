import { Config } from 'tailwindcss';

/**
 * CRM design tokens. Every colour is a CSS variable holding raw RGB channels
 * (see src/index.css), so `bg-accent/10` composites correctly and each theme
 * re-steps its own values instead of flipping one palette.
 *
 * Type is the business-app scale: the working band (meta → title) sits one
 * step above a developer tool's, so a sales team reads it comfortably all day.
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const tailwindConfig: Config = {
  darkMode: ['class'],
  content: ['index.html', 'src/**/*.{ts,tsx,css}', '../../packages/shared/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Figtree', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        display: ['Newsreader', 'ui-serif', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
      },
      fontSize: {
        micro: ['11px', { lineHeight: '14px', letterSpacing: '0.05em' }],
        meta: ['13px', '18px'],
        ui: ['14px', '20px'],
        body: ['15px', '23px'],
        title: ['17px', '24px'],
        'display-sm': ['24px', { lineHeight: '30px', letterSpacing: '-0.01em' }],
        display: ['32px', { lineHeight: '38px', letterSpacing: '-0.015em' }],
        'display-lg': ['44px', { lineHeight: '48px', letterSpacing: '-0.02em' }],
      },
      colors: {
        paper: token('paper'),
        card: token('card'),
        sunken: token('sunken'),
        hover: token('hover'),
        pressed: token('pressed'),
        line: token('line'),
        'line-strong': token('line-strong'),
        control: token('control'),
        ink: {
          DEFAULT: token('ink'),
          2: token('ink-2'),
          3: token('ink-3'),
        },
        primary: token('primary'),
        'on-primary': token('on-primary'),
        accent: token('accent'),
        'on-accent': token('on-accent'),
        success: token('success'),
        warning: token('warning'),
        danger: token('danger'),
        info: token('info'),
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        DEFAULT: '8px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
      },
      boxShadow: {
        hairline: '0 1px 0 rgb(var(--shadow) / 0.05)',
        raised: '0 1px 2px rgb(var(--shadow) / 0.06), 0 6px 16px -6px rgb(var(--shadow) / 0.12)',
        pop: '0 18px 44px -14px rgb(var(--shadow) / 0.30), 0 3px 8px -2px rgb(var(--shadow) / 0.08)',
        sheet: '-18px 0 44px -16px rgb(var(--shadow) / 0.28)',
        drag: '0 20px 40px -12px rgb(var(--shadow) / 0.35), 0 0 0 1px rgb(var(--line-strong) / 1)',
        key: 'inset 0 -1.5px 0 rgb(var(--line-strong) / 1)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
      keyframes: {
        'pop-in': { from: { opacity: '0', transform: 'translateY(-2px) scale(0.985)' }, to: { opacity: '1', transform: 'none' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'rise-in': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        'sheet-in': { from: { transform: 'translateX(24px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        'dialog-in': { from: { opacity: '0', transform: 'translate(-50%, 8px) scale(0.99)' }, to: { opacity: '1', transform: 'translate(-50%, 0) scale(1)' } },
        'bar-in': { from: { opacity: '0', transform: 'translate(-50%, 12px)' }, to: { opacity: '1', transform: 'translate(-50%, 0)' } },
        'deck-in': { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '0%': { backgroundPosition: '200% 0' }, '100%': { backgroundPosition: '-200% 0' } },
      },
      animation: {
        'pop-in': 'pop-in 140ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards',
        'fade-in': 'fade-in 140ms ease-out backwards',
        'rise-in': 'rise-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards',
        'sheet-in': 'sheet-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards',
        'dialog-in': 'dialog-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards',
        'bar-in': 'bar-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards',
        'deck-in': 'deck-in 260ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default tailwindConfig;
