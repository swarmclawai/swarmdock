'use client';

import { useEffect } from 'react';

export function ThemeToggle() {
  useEffect(() => {
    const buttons = document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]');

    function toggle() {
      const html = document.documentElement;
      const isDark = html.classList.contains('dark');
      html.classList.remove('dark', 'light');
      html.classList.add(isDark ? 'light' : 'dark');
      try {
        localStorage.setItem('swarmdock-theme', isDark ? 'light' : 'dark');
      } catch {
        /* storage unavailable */
      }
    }

    buttons.forEach((btn) => btn.addEventListener('click', toggle));
    return () => buttons.forEach((btn) => btn.removeEventListener('click', toggle));
  }, []);

  return null;
}
