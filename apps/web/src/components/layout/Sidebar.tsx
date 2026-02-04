import { cn } from '@/lib/utils';
import { Link, useLocation } from '@tanstack/react-router';
import { FolderOpen, Settings } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

const navItems = [{ to: '/browse', icon: FolderOpen, label: 'My Files' }] as const;

interface SidebarProps {
    isOpen?: boolean;
    onClose?: () => void;
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
    const location = useLocation();

    const navContent = (
        <>
            {/* Logo */}
            <div className="flex h-14 items-center border-b border-sidebar-border px-4">
                <Link to="/browse" className="flex items-center gap-2" onClick={onClose}>
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
                            onClick={onClose}
                            className={cn(
                                'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                                isActive
                                    ? 'bg-sidebar-accent text-sidebar-primary'
                                    : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                            )}
                        >
                            {isActive && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-sidebar-primary" />}
                            <Icon className={cn('size-4', isActive && 'text-sidebar-primary')} />
                            {label}
                        </Link>
                    );
                })}
            </nav>

            {/* Settings */}
            <div className="border-t border-sidebar-border p-3">
                <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    onClick={onClose}
                >
                    <Settings className="size-4" />
                    Settings
                </button>
            </div>
        </>
    );

    return (
        <>
            {/* Mobile backdrop */}
            <AnimatePresence>
                {isOpen && (
                    <motion.button
                        type="button"
                        aria-label="Close menu"
                        className="fixed inset-0 z-40 bg-black/50 md:hidden"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={onClose}
                    />
                )}
            </AnimatePresence>

            {/* Sidebar: drawer on mobile, static on desktop */}
            <aside
                className={cn(
                    'flex w-64 flex-col border-r border-sidebar-border bg-sidebar',
                    'fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-out md:relative md:transform-none',
                    !isOpen && '-translate-x-full md:translate-x-0',
                )}
            >
                {navContent}
            </aside>
        </>
    );
}
