import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/** Prefer server `message` from AppError JSON; otherwise `fallback`. */
export function getApiErrorMessage(error: unknown, fallback: string): string {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data;

        if (data && typeof data === 'object' && 'message' in data) {
            const msg = (data as { message?: unknown }).message;

            if (typeof msg === 'string' && msg.trim().length > 0) {
                return msg;
            }
        }
    }

    return fallback;
}

export interface AuthCallbacks {
    getToken: () => string | null;
    refresh: () => Promise<boolean>;
    logout: () => Promise<void>;
}

let authStore: AuthCallbacks | null = null;

export function initApiAuth(callbacks: AuthCallbacks) {
    authStore = callbacks;
}

function getAuthHeaders(): Record<string, string> {
    const token = authStore?.getToken();

    if (!token) return {};

    return { Authorization: `Bearer ${token}` };
}

/** Get current access token (for upload/XHR when axios is not used) */
export function getAccessToken(): string | null {
    return authStore?.getToken() ?? null;
}

export const apiClient = axios.create({
    baseURL: API_BASE,
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
    },
});

apiClient.interceptors.request.use((config) => {
    const authHeaders = getAuthHeaders();

    Object.assign(config.headers, authHeaders);

    return config;
});

apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry && authStore) {
            originalRequest._retry = true;

            const refreshed = await authStore.refresh();

            if (refreshed) {
                const authHeaders = getAuthHeaders();

                Object.assign(originalRequest.headers, authHeaders);

                return apiClient(originalRequest);
            }

            await authStore.logout();
        }

        return Promise.reject(error);
    },
);

/**
 * Fetch wrapper for SSE/streaming - axios cannot stream responses in browser.
 * Uses same auth store as apiClient (token, 401 refresh, logout).
 */
export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    const token = authStore?.getToken();

    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    let response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
    });

    if (response.status === 401 && authStore) {
        const refreshed = await authStore.refresh();

        if (refreshed) {
            const newToken = authStore.getToken();

            if (newToken) {
                headers.set('Authorization', `Bearer ${newToken}`);
                response = await fetch(url, {
                    ...options,
                    headers,
                    credentials: 'include',
                });
            }
        } else {
            await authStore.logout();
        }
    }

    return response;
}
