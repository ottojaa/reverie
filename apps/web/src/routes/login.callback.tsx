import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const Route = createFileRoute('/login/callback')({
    validateSearch: (search: Record<string, unknown>) => ({
        code: search.code as string | undefined,
        access_token: search.access_token as string | undefined, // legacy
    }),
    component: LoginCallbackPage,
});

function LoginCallbackPage() {
    const navigate = useNavigate();
    const { code, access_token } = useSearch({ from: '/login/callback' });

    useEffect(() => {
        const completeLogin = (token: string) => {
            localStorage.setItem('reverie_access_token', token);
            fetch(`${API_BASE}/auth/me`, {
                headers: { Authorization: `Bearer ${token}` },
            })
                .then((res) => res.json())
                .then((data) => {
                    if (data.user) {
                        localStorage.setItem('reverie_user', JSON.stringify(data.user));
                    }

                    navigate({ to: '/browse' });
                })
                .catch(() => navigate({ to: '/browse' }));
        };

        if (code) {
            fetch(`${API_BASE}/auth/exchange-oauth-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ code }),
            })
                .then((res) => {
                    if (!res.ok) throw new Error('Invalid code');

                    return res.json();
                })
                .then((data) => completeLogin(data.access_token))
                .catch(() => navigate({ to: '/login', search: { error: 'google_auth_failed' } }));
        } else if (access_token) {
            completeLogin(access_token);
        } else {
            navigate({ to: '/login', search: { error: 'google_auth_failed' } });
        }
    }, [code, access_token, navigate]);

    return (
        <div className="flex min-h-dvh items-center justify-center">
            <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                <p className="mt-4 text-muted-foreground">Completing sign in...</p>
            </div>
        </div>
    );
}
