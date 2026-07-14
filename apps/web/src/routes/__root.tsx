import { createRootRoute, Outlet, useLocation, useMatches, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Layout } from '../components/layout/Layout';
import { TooltipProvider } from '../components/ui/tooltip';
import { useAuth } from '../lib/auth';
import { usePathnameTracker } from '../lib/hooks/useNavigationDirection';
import { UploadProvider } from '../lib/upload';

// Routes that don't require authentication
const publicRoutes = ['/', '/login', '/login/callback'];

// Route ids that render without the Layout chrome (sidebar/header)
const fullBleedRouteIds = ['/canvas'];

function RootComponent() {
    const { isAuthenticated, isLoading } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const matches = useMatches();

    // Global pathname tracker for useIsReturningFromDocument — must run on
    // every route, including full-bleed ones that skip Layout.
    usePathnameTracker();

    const isPublicRoute = publicRoutes.some((route) => location.pathname === route || location.pathname.startsWith('/login'));
    // Keyed on the RENDERED matches, not location.pathname: during a route
    // transition the pathname flips before the old match unmounts, and
    // dropping Layout's providers while e.g. Browse still renders crashes it
    // (useSectionEdit outside SectionEditProvider).
    const isFullBleedRoute = matches.some((match) => fullBleedRouteIds.includes(match.routeId));

    useEffect(() => {
        if (isLoading) return;

        if (isAuthenticated) return;

        const pathname = location.pathname;
        const isPublic = publicRoutes.some((route) => pathname === route || pathname.startsWith('/login'));

        if (isPublic) return;

        navigate({ to: '/login', search: { error: 'unauthorized_access' }, replace: true });
    }, [isAuthenticated, isLoading, location.pathname, navigate]);

    // Show loading state
    if (isLoading) {
        return (
            <div className="flex min-h-dvh items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    // For public routes, render without layout (login has its own layout)
    if (isPublicRoute && !isAuthenticated) {
        return <Outlet />;
    }

    // Full-bleed routes (canvas) own the whole viewport — no sidebar/header
    if (isFullBleedRoute) {
        return (
            <TooltipProvider>
                <Outlet />
            </TooltipProvider>
        );
    }

    // For authenticated routes, render with layout
    return (
        <TooltipProvider>
            <UploadProvider>
                <Layout>
                    <Outlet />
                </Layout>
            </UploadProvider>
        </TooltipProvider>
    );
}

export const Route = createRootRoute({
    component: RootComponent,
});
