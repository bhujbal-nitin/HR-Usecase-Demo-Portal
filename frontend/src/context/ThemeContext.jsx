import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useToast } from './ToastContext';

export const THEMES = [
  { id: 'light', label: '☀️ Enterprise Light (Clean & Crisp)', name: 'Enterprise Light', icon: 'fa-sun' },
  { id: 'dark', label: '🌙 Midnight Slate (Dark Mode)', name: 'Midnight Slate', icon: 'fa-moon' },
  { id: 'blue', label: '💙 Royal Sapphire (Blue)', name: 'Royal Sapphire', icon: 'fa-droplet' },
  { id: 'emerald', label: '🌿 Emerald Mint (Teal)', name: 'Emerald Mint', icon: 'fa-leaf' },
  { id: 'purple', label: '💜 Amethyst Purple (Executive)', name: 'Amethyst Purple', icon: 'fa-gem' },
];
const STORAGE_KEY = 'hr-portal-theme';

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return THEMES.some((t) => t.id === stored) ? stored : 'light';
  } catch {
    return 'light'; // storage can be blocked (private mode)
  }
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const { showToast } = useToast();
  const [theme, setThemeState] = useState(readStoredTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = useCallback(
    (id) => {
      const next = THEMES.find((t) => t.id === id);
      if (!next) return;
      setThemeState(id);
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        /* ignore */
      }
      showToast(`🎨 Theme changed to: ${next.name}`, 'info');
    },
    [showToast],
  );

  const cycleTheme = useCallback(() => {
    const index = THEMES.findIndex((t) => t.id === theme);
    setTheme(THEMES[(index + 1) % THEMES.length].id);
  }, [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, cycleTheme }), [theme, setTheme, cycleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
