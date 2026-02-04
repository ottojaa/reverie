import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
    component: function IndexPage() {
        return <Navigate to="/browse" />;
    },
});
