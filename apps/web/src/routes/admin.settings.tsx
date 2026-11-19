import { ServerSettingRow } from '@/components/admin/ServerSettingRow';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/api/admin';
import { getApiErrorMessage } from '@/lib/api/client';
import { useAuth } from '@/lib/auth';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

export const Route = createFileRoute('/admin/settings')({
    component: AdminSettingsPage,
});

function AdminSettingsPage() {
    const { user, accessToken } = useAuth();
    const navigate = useNavigate();
    const isAdmin = user?.role === 'admin';

    const {
        data: settings = [],
        isLoading,
        error,
    } = useQuery({
        queryKey: ['admin', 'settings'],
        queryFn: () => adminApi.listSettings(),
        enabled: !!accessToken && isAdmin,
    });

    useEffect(() => {
        if (user && !isAdmin) navigate({ to: '/browse' });
    }, [user, isAdmin, navigate]);

    if (!isAdmin) return null;

    return (
        <div className="container p-6">
            <div className="mb-6">
                <h1 className="text-2xl font-bold tracking-tight">Server settings</h1>
                <p className="mt-1 text-sm text-muted-foreground">Changes apply to the server right away. Anything you reset falls back to its default.</p>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                {isLoading && (
                    <div className="space-y-4 p-5">
                        {[1, 2].map((i) => (
                            <Skeleton key={i} className="h-16 w-full" />
                        ))}
                    </div>
                )}
                {error && <p className="p-5 text-sm text-destructive">{getApiErrorMessage(error, 'Failed to load settings')}</p>}
                <ul className="divide-y divide-border">
                    {settings.map((setting) => (
                        <li key={setting.key}>
                            <ServerSettingRow key={JSON.stringify(setting.value)} setting={setting} />
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
