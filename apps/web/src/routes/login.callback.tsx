import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const Route = createFileRoute('/login/callback')({
    validateSearch: (search: Record<string, unknown>) => ({
        access_token: search.access_token as string | undefined,
        expires_in: search.expires_in as string | undefined,
    }),
    component: LoginCallbackPage,
});

function LoginCallbackPage() {
    const navigate = useNavigate();
    const { access_token, expires_in } = useSearch({ from: '/login/callback' });

    useEffect(() => {
        if (access_token) {
            // Store the token
            localStorage.setItem('reverie_access_token', access_token);

            // Fetch user info and store it
            fetch(`${API_BASE}/auth/me`, {
                headers: {
                    Authorization: `Bearer ${access_token}`,
                },
            })
                .then((res) => res.json())
                .then((data) => {
                    if (data.user) {
                        localStorage.setItem('reverie_user', JSON.stringify(data.user));
                    }
                    // Redirect to browse page
                    navigate({ to: '/browse' });
                })
                .catch(() => {
                    // If fetching user fails, still redirect (user will be fetched on next page load)
                    navigate({ to: '/browse' });
                });
        } else {
            // No token, redirect to login
            navigate({ to: '/login', search: { error: 'google_auth_failed' } });
        }
    }, [access_token, navigate]);

    return (
        <div className="flex min-h-screen items-center justify-center">
            <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                <p className="mt-4 text-muted-foreground">Completing sign in...</p>
            </div>
        </div>
    );
}
