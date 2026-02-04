import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useAuth } from '../lib/auth';

export const Route = createFileRoute('/')({
    component: function IndexPage() {
        const { isAuthenticated, isLoading } = useAuth();
        if (isLoading) return null;
        return <Navigate to={isAuthenticated ? '/browse' : '/login'} />;
    },
});
