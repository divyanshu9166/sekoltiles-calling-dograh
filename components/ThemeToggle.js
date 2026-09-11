'use client';

import { useLayoutEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'calling-agent-theme';
const DEFAULT_THEME = 'dark';

function readTheme() {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const storedTheme = window.localStorage.getItem(STORAGE_KEY);
  return storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : DEFAULT_THEME;
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);

  useLayoutEffect(() => {
    const savedTheme = readTheme();
    document.documentElement.dataset.theme = savedTheme;
    setTheme(savedTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    setTheme(nextTheme);
  };

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="touch-target inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      {isDark ? <Sun className="h-3.5 w-3.5 text-warning" /> : <Moon className="h-3.5 w-3.5 text-accent" />}
      <span className="hidden sm:inline">{isDark ? 'Light mode' : 'Dark mode'}</span>
    </button>
  );
}
