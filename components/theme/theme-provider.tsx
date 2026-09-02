"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { isTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("paper");

  useEffect(() => {
    // One-time sync from an external system (the DOM attribute
    // theme-script.tsx set before hydration, to avoid a flash of the
    // wrong theme) into React state. Can't compute this in a lazy
    // useState initializer instead — `document` doesn't exist during
    // this component's server render.
    const current = document.documentElement.getAttribute("data-theme");
    if (isTheme(current)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setThemeState(current);
    }
  }, []);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (private mode, quota) — the theme still
      // applies for this page view, it just won't persist.
    }
    setThemeState(next);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
