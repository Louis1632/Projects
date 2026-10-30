import { useState } from 'react';

const NAV_KEY = 'tido.navHidden';
// Matches the phone breakpoint in styles.css.
const PHONE_QUERY = '(max-width: 760px)';

/** Phones show the sidebar as a drawer over the page, so it closes after each choice. */
export const isPhone = () => window.matchMedia?.(PHONE_QUERY).matches ?? false;

function readHidden(): boolean {
  try {
    return localStorage.getItem(NAV_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Whether the sidebar is showing. On a computer it starts as last left on this browser; on a
 * phone it always starts closed, and opening it there is not remembered.
 */
export function useNavOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => !isPhone() && !readHidden());
  const choose = (next: boolean) => {
    if (!isPhone()) {
      try {
        if (next) localStorage.removeItem(NAV_KEY);
        else localStorage.setItem(NAV_KEY, 'true');
      } catch {
        // Storage can be unavailable (private mode); the choice then lasts until reload.
      }
    }
    setOpen(next);
  };
  return [open, choose];
}
