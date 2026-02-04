import { createRootRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Layout } from '../components/layout/Layout';
import { useAuth } from '../lib/auth';
import { UploadProvider } from '../lib/upload';

// Routes that don't require authentication
const publicRoutes = ['/', '/login', '/login/callback'];

function RootComponent() {
    const { isAuthenticated, isLoading } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

    const isPublicRoute = publicRoutes.some((route) => location.pathname === route || location.pathname.startsWith('/login'));

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
            <div className="flex min-h-screen items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    // For public routes, render without layout (login has its own layout)
    if (isPublicRoute && !isAuthenticated) {
        return <Outlet />;
    }

    // For authenticated routes, render with layout
    return (
        <UploadProvider>
            <Layout>
                <Outlet />
            </Layout>
        </UploadProvider>
    );
}

export const Route = createRootRoute({
    component: RootComponent,
});
