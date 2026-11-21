import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAuth } from '../lib/auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// The trailing underscore in the file name (`login_`) keeps this page out of `/login`'s layout: `/login` renders no
// <Outlet />, so a nested callback route would never show and the one-time code would never be exchanged.
export const Route = createFileRoute('/login_/callback')({
    validateSearch: (search: Record<string, unknown>) => ({
        code: search.code as string | undefined,
        access_token: search.access_token as string | undefined, // legacy
    }),
    component: LoginCallbackPage,
});

// The code works once, but this page can mount more than once for the same URL (React's dev double-run of effects, the
// router remounting a lazily loaded route). Sharing one request per code keeps a second mount from spending it again.
const exchanges = new Map<string, Promise<string>>();

function exchangeCode(code: string): Promise<string> {
    const pending = exchanges.get(code);

    if (pending) return pending;

    const exchange = fetch(`${API_BASE}/auth/exchange-oauth-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code }),
    }).then(async (res) => {
        if (!res.ok) throw new Error('Invalid code');

        const data = (await res.json()) as { access_token: string };

        return data.access_token;
    });

    exchanges.set(code, exchange);

    return exchange;
}

function LoginCallbackPage() {
    const navigate = useNavigate();
    const { completeProviderLogin } = useAuth();
    const { code, access_token } = useSearch({ from: '/login_/callback' });

    useEffect(() => {
        const completeLogin = (token: string) => {
            completeProviderLogin(token)
                .then(() => navigate({ to: '/browse' }))
                .catch(() => navigate({ to: '/login', search: { error: 'oidc_auth_failed' } }));
        };

        if (code) {
            exchangeCode(code)
                .then(completeLogin)
                .catch(() => navigate({ to: '/login', search: { error: 'oidc_auth_failed' } }));
        } else if (access_token) {
            completeLogin(access_token);
        } else {
            navigate({ to: '/login', search: { error: 'oidc_auth_failed' } });
        }
    }, [code, access_token, navigate, completeProviderLogin]);

    return (
        <div className="flex min-h-dvh items-center justify-center">
            <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                <p className="mt-4 text-muted-foreground">Completing sign in...</p>
            </div>
        </div>
    );
}
