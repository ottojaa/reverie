import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Bell, Moon, Search, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

const THEME_KEY = 'reverie-theme';

function getInitialTheme(): boolean {
    // Check localStorage first
    const stored = localStorage.getItem(THEME_KEY);
    if (stored !== null) {
        return stored === 'dark';
    }
    // Fall back to system preference, default to dark
    if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true; // Default to dark
}

export function Header() {
    const [isDark, setIsDark] = useState(() => getInitialTheme());

    // Apply theme on mount and when changed
    useEffect(() => {
        document.documentElement.classList.toggle('dark', isDark);
        localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    }, [isDark]);

    const toggleTheme = () => {
        setIsDark((prev) => !prev);
    };

    return (
        <header className="flex h-14 items-center justify-between border-b bg-background px-4">
            <div className="flex flex-1 items-center gap-4">
                <div className="relative w-96">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input placeholder="Search documents..." className="pl-10" />
                </div>
            </div>

            <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon">
                    <Bell className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={toggleTheme}>
                    {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </Button>
            </div>
        </header>
    );
}
