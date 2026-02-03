import { cn } from '@/lib/utils';
import { Link, useLocation } from '@tanstack/react-router';
import { FolderOpen, Home, Search, Settings, Upload } from 'lucide-react';

const navItems = [
    { to: '/', icon: Home, label: 'Home' },
    { to: '/browse', icon: FolderOpen, label: 'Browse' },
    { to: '/upload', icon: Upload, label: 'Upload' },
    { to: '/search', icon: Search, label: 'Search' },
] as const;

export function Sidebar() {
    const location = useLocation();

    return (
        <aside className="flex w-64 flex-col border-r border-sidebar-border bg-sidebar">
            {/* Logo */}
            <div className="flex h-14 items-center border-b border-sidebar-border px-4">
                <Link to="/" className="flex items-center gap-2">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <span className="text-sm font-bold">R</span>
                    </div>
                    <span className="text-lg font-semibold tracking-tight">Reverie</span>
                </Link>
            </div>

            {/* Navigation */}
            <nav className="flex-1 space-y-1 p-3">
                {navItems.map(({ to, icon: Icon, label }) => {
                    const isActive = location.pathname === to;
                    return (
                        <Link
                            key={to}
                            to={to}
                            className={cn(
                                'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                                isActive
                                    ? 'bg-sidebar-accent text-sidebar-primary'
                                    : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                            )}
                        >
                            {/* Active indicator */}
                            {isActive && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-sidebar-primary" />}
                            <Icon className={cn('size-4', isActive && 'text-sidebar-primary')} />
                            {label}
                        </Link>
                    );
                })}
            </nav>

            {/* Settings */}
            <div className="border-t border-sidebar-border p-3">
                <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
                    <Settings className="size-4" />
                    Settings
                </button>
            </div>
        </aside>
    );
}
