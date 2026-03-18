import { useOrganize } from '@/components/layout/Layout';
import { SearchCommandPalette } from '@/components/search/SearchCommandPalette';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';
import { useLocation } from '@tanstack/react-router';
import { Bell, Menu, Moon, Search, Sparkles, Sun } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface HeaderProps {
    onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
    const { isDark, setIsDark } = useTheme();
    const { openOrganize } = useOrganize();
    const [searchOpen, setSearchOpen] = useState(false);
    const { pathname } = useLocation();
    const isSearchPage = pathname === '/search';

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setSearchOpen((prev) => !prev);
            }
        };

        document.addEventListener('keydown', handler);

        return () => document.removeEventListener('keydown', handler);
    }, []);

    const openSearch = useCallback(() => setSearchOpen(true), []);

    return (
        <>
            <header className="flex h-14 items-center justify-between gap-2 border-b bg-background px-3 md:px-4">
                <div className="flex flex-1 items-center gap-2 md:gap-4">
                    {onMenuClick && (
                        <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenuClick} aria-label="Open menu">
                            <Menu className="size-5" />
                        </Button>
                    )}
                    {!isSearchPage && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={openSearch}
                            className="relative min-w-0 flex-1 justify-start gap-2.5 px-3.5 py-2 text-sm text-muted-foreground md:max-w-96"
                        >
                            <Search className="size-4 shrink-0" />
                            <span className="truncate">Search documents...</span>
                            <kbd className="ml-auto hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground md:inline-block">
                                ⌘K
                            </kbd>
                        </Button>
                    )}
                </div>

                <div className="flex shrink-0 items-center gap-1 md:gap-2">
                    <Button variant="ghost" className="gap-2 px-2 md:px-3" onClick={openOrganize} aria-label="Organize with AI">
                        <Sparkles className="size-4 shrink-0 text-primary" />
                        <span className="hidden sm:inline">Organize</span>
                        <kbd className="ml-auto hidden shrink-0 rounded bg-sidebar-border px-1.5 py-0.5 text-[10px] opacity-60 md:inline-block">⌘⇧O</kbd>
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Notifications">
                        <Bell className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setIsDark((d) => !d)} aria-label="Toggle theme">
                        {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                    </Button>
                </div>
            </header>

            <SearchCommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
        </>
    );
}
