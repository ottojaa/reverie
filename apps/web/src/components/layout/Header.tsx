import { useOrganize } from '@/components/layout/Layout';
import { SearchCommandPalette } from '@/components/search/SearchCommandPalette';
import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme';
import { useVault } from '@/lib/vault';
import { useLocation } from '@tanstack/react-router';
import { Bell, LockOpen, Menu, Moon, Search, Sparkles, Sun } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface HeaderProps {
    onMenuClick?: () => void;
}

// Ghost's default hover is full-strength accent (indigo) — far too loud for header chrome
const quietHover = 'hover:bg-secondary hover:text-foreground dark:hover:bg-secondary';

/** The app-level action cluster (vault, Organize, notifications, theme) — also embedded in the /search shell. */
export function HeaderActions() {
    const { isDark, setIsDark } = useTheme();
    const { openOrganize } = useOrganize();
    const { unlocked, lockNow } = useVault();

    return (
        <div className="flex shrink-0 items-center gap-1 md:gap-2">
            {unlocked && (
                <button
                    type="button"
                    onClick={lockNow}
                    className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
                    title="Private items are visible — click to lock"
                >
                    <LockOpen className="size-3.5" />
                    <span className="hidden sm:inline">Private visible</span>
                </button>
            )}
            <Button variant="ghost" className={cn('gap-2 px-2 md:px-3', quietHover)} onClick={openOrganize} aria-label="Organize with AI">
                <Sparkles className="size-4 shrink-0 text-primary" />
                <span className="hidden sm:inline">Organize</span>
                <kbd className="ml-auto hidden shrink-0 rounded bg-sidebar-border px-1.5 py-0.5 text-[10px] opacity-60 md:inline-block">⌘⇧O</kbd>
            </Button>
            <Button variant="ghost" size="icon" className={quietHover} aria-label="Notifications">
                <Bell className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className={quietHover} onClick={() => setIsDark((d) => !d)} aria-label="Toggle theme">
                {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
        </div>
    );
}

export function Header({ onMenuClick }: HeaderProps) {
    const [searchOpen, setSearchOpen] = useState(false);
    const { pathname } = useLocation();
    const isDesktop = useMediaQuery('(min-width: 768px)');
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

    // On desktop /search the search shell IS the header (it embeds HeaderActions) —
    // skip the app bar entirely so there's a single block of chrome
    if (isSearchPage && isDesktop) {
        return <SearchCommandPalette open={searchOpen} onOpenChange={setSearchOpen} />;
    }

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

                <HeaderActions />
            </header>

            <SearchCommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
        </>
    );
}
