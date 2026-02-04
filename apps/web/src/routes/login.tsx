import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { useAuth } from '../lib/auth';

export const Route = createFileRoute('/login')({
    validateSearch: (search: Record<string, unknown>) => ({
        error: search.error as string | undefined,
    }),
    component: LoginPage,
});

function LoginPage() {
    const { login, loginWithGoogle, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const { error: urlError } = useSearch({ from: '/login' });

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(urlError || null);
    const [isLoading, setIsLoading] = useState(false);
    const prevAuthRef = useRef(isAuthenticated);

    useEffect(() => {
        if (isAuthenticated && !prevAuthRef.current) {
            prevAuthRef.current = true;
            navigate({ to: '/browse', replace: true });
        }
        prevAuthRef.current = isAuthenticated;
    }, [isAuthenticated, navigate]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        try {
            await login(email, password);
            navigate({ to: '/browse' });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Login failed');
        } finally {
            setIsLoading(false);
        }
    };

    const getErrorMessage = (errorCode: string | null): string => {
        if (!errorCode) return '';
        switch (errorCode) {
            case 'unauthorized_access':
                return 'Please sign in to continue.';
            case 'google_account_not_linked':
                return 'No account found for this Google account. Please contact an administrator.';
            case 'google_auth_failed':
                return 'Google authentication failed. Please try again.';
            case 'invalid_credentials':
                return 'Invalid email or password.';
            case 'account_disabled':
                return 'Your account has been disabled.';
            default:
                return errorCode;
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <CardTitle className="text-2xl">Welcome to Reverie</CardTitle>
                    <CardDescription>Sign in to access your documents</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{getErrorMessage(error)}</div>}

                        <div className="space-y-2">
                            <label htmlFor="email" className="text-sm font-medium">
                                Email
                            </label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                disabled={isLoading}
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="password" className="text-sm font-medium">
                                Password
                            </label>
                            <Input
                                id="password"
                                type="password"
                                placeholder="Enter your password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                disabled={isLoading}
                            />
                        </div>

                        <Button type="submit" className="w-full" disabled={isLoading}>
                            {isLoading ? 'Signing in...' : 'Sign in'}
                        </Button>

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                            </div>
                        </div>

                        <Button type="button" variant="outline" className="w-full" onClick={loginWithGoogle} disabled={isLoading}>
                            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                                <path
                                    fill="currentColor"
                                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                />
                                <path
                                    fill="currentColor"
                                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                />
                                <path
                                    fill="currentColor"
                                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                />
                                <path
                                    fill="currentColor"
                                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                />
                            </svg>
                            Sign in with Google
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
