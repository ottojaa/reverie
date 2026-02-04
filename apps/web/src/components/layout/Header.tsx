import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Bell, Menu, Moon, Search, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

const THEME_KEY = 'reverie-theme';

function getInitialTheme(): boolean {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored !== null) return stored === 'dark';
    if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true;
}

interface HeaderProps {
    onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
    const [isDark, setIsDark] = useState(() => getInitialTheme());

    useEffect(() => {
        document.documentElement.classList.toggle('dark', isDark);
        localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    }, [isDark]);

    return (
        <header className="flex h-14 items-center justify-between gap-2 border-b bg-background px-3 md:px-4">
            <div className="flex flex-1 items-center gap-2 md:gap-4">
                {onMenuClick && (
                    <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenuClick} aria-label="Open menu">
                        <Menu className="size-5" />
                    </Button>
                )}
                <div className="relative min-w-0 flex-1 md:max-w-96">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 shrink-0 text-muted-foreground" />
                    <Input placeholder="Search documents..." className="pl-10" />
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-1 md:gap-2">
                <Button variant="ghost" size="icon" aria-label="Notifications">
                    <Bell className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setIsDark((d) => !d)} aria-label="Toggle theme">
                    {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </Button>
            </div>
        </header>
    );
}
