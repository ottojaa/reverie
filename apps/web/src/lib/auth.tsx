import type { LoginResponse, User } from '@reverie/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface AuthState {
    user: User | null;
    accessToken: string | null;
    isLoading: boolean;
    isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    refreshToken: () => Promise<boolean>;
    loginWithGoogle: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const ACCESS_TOKEN_KEY = 'reverie_access_token';
const USER_KEY = 'reverie_user';

export function AuthProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<AuthState>({
        user: null,
        accessToken: null,
        isLoading: true,
        isAuthenticated: false,
    });

    // Initialize auth state from localStorage
    useEffect(() => {
        const storedToken = localStorage.getItem(ACCESS_TOKEN_KEY);
        const storedUser = localStorage.getItem(USER_KEY);

        if (storedToken && storedUser) {
            try {
                const user = JSON.parse(storedUser) as User;
                setState({
                    user,
                    accessToken: storedToken,
                    isLoading: false,
                    isAuthenticated: true,
                });
                // Verify token is still valid by fetching current user
                verifyToken(storedToken);
            } catch {
                clearAuthState();
            }
        } else {
            setState((prev) => ({ ...prev, isLoading: false }));
        }
    }, []);

    const verifyToken = async (token: string) => {
        try {
            const response = await fetch(`${API_BASE}/auth/me`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!response.ok) {
                // Token is invalid, try to refresh
                const refreshed = await refreshToken();
                if (!refreshed) {
                    clearAuthState();
                }
                return;
            }

            const data = await response.json();
            setState((prev) => ({
                ...prev,
                user: data.user,
                isLoading: false,
            }));
            localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        } catch {
            clearAuthState();
        }
    };

    const clearAuthState = () => {
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setState({
            user: null,
            accessToken: null,
            isLoading: false,
            isAuthenticated: false,
        });
    };

    const login = async (email: string, password: string) => {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include', // Include cookies for refresh token
            body: JSON.stringify({ email, password }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Login failed');
        }

        const data: LoginResponse = await response.json();

        localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));

        setState({
            user: data.user,
            accessToken: data.access_token,
            isLoading: false,
            isAuthenticated: true,
        });
    };

    const logout = async () => {
        try {
            await fetch(`${API_BASE}/auth/logout`, {
                method: 'POST',
                credentials: 'include',
            });
        } catch {
            // Ignore logout errors
        } finally {
            clearAuthState();
        }
    };

    const refreshToken = useCallback(async (): Promise<boolean> => {
        try {
            const response = await fetch(`${API_BASE}/auth/refresh`, {
                method: 'POST',
                credentials: 'include', // Include refresh token cookie
            });

            if (!response.ok) {
                return false;
            }

            const data = await response.json();
            localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
            setState((prev) => ({
                ...prev,
                accessToken: data.access_token,
            }));
            return true;
        } catch {
            return false;
        }
    }, []);

    const loginWithGoogle = () => {
        // Redirect to Google OAuth endpoint
        window.location.href = `${API_BASE}/auth/google`;
    };

    return (
        <AuthContext.Provider
            value={{
                ...state,
                login,
                logout,
                refreshToken,
                loginWithGoogle,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

/**
 * Hook for making authenticated API requests
 */
export function useAuthenticatedFetch() {
    const { accessToken, refreshToken, logout } = useAuth();

    return useCallback(
        async (url: string, options: RequestInit = {}) => {
            const headers = new Headers(options.headers);
            if (accessToken) {
                headers.set('Authorization', `Bearer ${accessToken}`);
            }

            let response = await fetch(url, {
                ...options,
                headers,
                credentials: 'include',
            });

            // If unauthorized, try to refresh token
            if (response.status === 401) {
                const refreshed = await refreshToken();
                if (refreshed) {
                    // Retry with new token
                    const newToken = localStorage.getItem(ACCESS_TOKEN_KEY);
                    if (newToken) {
                        headers.set('Authorization', `Bearer ${newToken}`);
                        response = await fetch(url, {
                            ...options,
                            headers,
                            credentials: 'include',
                        });
                    }
                } else {
                    // Refresh failed, logout
                    await logout();
                }
            }

            return response;
        },
        [accessToken, refreshToken, logout],
    );
}
