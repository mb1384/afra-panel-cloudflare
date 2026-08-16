export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'afra:theme';

export function getStoredTheme(): ThemeMode {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function applyTheme(mode: ThemeMode): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = mode === 'dark' || (mode === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem(STORAGE_KEY, mode);
}

export function applyStoredTheme(): void {
  applyTheme(getStoredTheme());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoredTheme() === 'system') applyTheme('system');
  });
}
