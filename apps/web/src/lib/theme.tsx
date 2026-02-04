import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const THEME_KEY = 'reverie-theme';

function getInitialTheme(): boolean {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(THEME_KEY);
    if (stored !== null) return stored === 'dark';
    if (window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true;
}

type ThemeContextValue = {
    isDark: boolean;
    setIsDark: (value: boolean | ((prev: boolean) => boolean)) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [isDark, setIsDark] = useState(getInitialTheme);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', isDark);
        localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    }, [isDark]);

    const value: ThemeContextValue = { isDark, setIsDark };
    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
    return ctx;
}
