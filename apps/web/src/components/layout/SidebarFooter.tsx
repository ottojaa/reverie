import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import type { User } from '@reverie/shared';
import { Link } from '@tanstack/react-router';
import { Bot, ChevronUp, Settings, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useId, useState } from 'react';

export const FOOTER_OPEN_KEY = 'reverie-sidebar-footer-open';

const EASE = [0.22, 1, 0.36, 1] as const;

type FooterLinkTarget = '/settings' | '/agent' | '/admin/users' | '/admin/settings';

interface FooterLink {
    to: FooterLinkTarget;
    label: string;
    Icon: LucideIcon;
}

const MEMBER_LINKS: FooterLink[] = [{ to: '/settings', label: 'Settings', Icon: Settings }];

const ADMIN_LINKS: FooterLink[] = [
    { to: '/agent', label: 'Agent', Icon: Bot },
    { to: '/admin/users', label: 'Users', Icon: Users },
    { to: '/admin/settings', label: 'Server settings', Icon: SlidersHorizontal },
];

function loadStoredOpen(): boolean {
    try {
        return localStorage.getItem(FOOTER_OPEN_KEY) === '1';
    } catch {
        return false;
    }
}

function saveStoredOpen(open: boolean): void {
    try {
        localStorage.setItem(FOOTER_OPEN_KEY, open ? '1' : '0');
    } catch {
        // Storage unavailable (private window, blocked site data): the choice just won't persist.
    }
}

interface SidebarFooterProps {
    user: Pick<User, 'role' | 'storage_used_bytes' | 'storage_quota_bytes'> | null | undefined;
    pathname: string;
    onClose?: (() => void) | undefined;
}

export function SidebarFooter({ user, pathname, onClose }: SidebarFooterProps) {
    const [isOpen, setIsOpen] = useState(loadStoredOpen);
    const reduceMotion = useReducedMotion();
    const linksId = useId();
    const links = user?.role === 'admin' ? [...MEMBER_LINKS, ...ADMIN_LINKS] : MEMBER_LINKS;
    const toggleSubject = user?.role === 'admin' ? 'settings and admin links' : 'settings';
    const storagePct = user && user.storage_quota_bytes > 0 ? (user.storage_used_bytes / user.storage_quota_bytes) * 100 : 0;
    const duration = reduceMotion ? 0 : 0.25;

    const toggle = () => {
        const next = !isOpen;

        setIsOpen(next);
        saveStoredOpen(next);
    };

    return (
        <div className="shrink-0 border-t border-sidebar-border p-2">
            {/* Always rendered so the toggle's aria-controls resolves while collapsed too. */}
            <div id={linksId}>
                <AnimatePresence initial={false}>
                    {isOpen && (
                        <motion.div
                            key="links"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration, ease: EASE }}
                            className="overflow-hidden"
                        >
                            <div className="flex flex-col pb-1">
                                {links.map(({ to, label, Icon }) => (
                                    <Link
                                        key={to}
                                        to={to}
                                        className={cn(
                                            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                                            pathname === to
                                                ? 'bg-sidebar-accent text-sidebar-primary'
                                                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                                        )}
                                        onClick={onClose}
                                    >
                                        <Icon className="size-4" />
                                        {label}
                                    </Link>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div className="flex items-center gap-1">
                {user ? (
                    <Link to="/settings" className="block min-w-0 flex-1 rounded-md px-3 py-2 transition-colors hover:bg-sidebar-accent" onClick={onClose}>
                        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                            <div
                                className="h-full rounded-full bg-success transition-all duration-500 ease-out"
                                style={{ width: `${Math.min(storagePct, 100)}%` }}
                            />
                        </div>
                        <div className="mt-1.5 truncate text-xs text-muted-foreground">
                            {formatFileSize(user.storage_used_bytes)} of {formatFileSize(user.storage_quota_bytes)} used
                        </div>
                    </Link>
                ) : (
                    <div className="flex-1" />
                )}
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground dark:hover:bg-sidebar-accent"
                    aria-expanded={isOpen}
                    aria-controls={linksId}
                    aria-label={`${isOpen ? 'Hide' : 'Show'} ${toggleSubject}`}
                    onClick={toggle}
                >
                    <motion.span className="flex" animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration, ease: EASE }}>
                        <ChevronUp className="size-4" />
                    </motion.span>
                </Button>
            </div>
        </div>
    );
}
