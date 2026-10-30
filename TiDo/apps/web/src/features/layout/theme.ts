import { useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const THEME_KEY = 'tido.theme';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Sets data-theme on <html>; styles.css follows the device when it is absent. */
export function applyTheme(theme: Theme = readTheme()) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/** The theme this browser uses, remembered per device rather than per account. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState(readTheme);
  const choose = (next: Theme) => {
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); the choice then lasts until reload.
    }
    applyTheme(next);
    setTheme(next);
  };
  return [theme, choose];
}
