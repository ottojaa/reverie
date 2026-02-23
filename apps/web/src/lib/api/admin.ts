import type {
    CreateUserRequest,
    CreateUserResponse,
    ListUsersResponse,
    UpdateUserRequest,
    UpdateUserResponse,
    User,
} from '@reverie/shared';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function adminFetch(path: string, accessToken: string, init?: RequestInit) {
    return fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            ...init?.headers,
        },
        credentials: 'include',
    });
}

export async function listUsers(accessToken: string): Promise<User[]> {
    const res = await adminFetch('/admin/users', accessToken);

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));

        throw new Error((data as { message?: string }).message ?? 'Failed to list users');
    }

    const data: ListUsersResponse = await res.json();

    return data.users;
}

export async function updateUser(
    userId: string,
    body: UpdateUserRequest,
    accessToken: string,
): Promise<User> {
    const res = await adminFetch(`/admin/users/${userId}`, accessToken, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));

        throw new Error((data as { message?: string }).message ?? 'Failed to update user');
    }

    const data: UpdateUserResponse = await res.json();

    return data.user;
}

export async function createUser(body: CreateUserRequest, accessToken: string): Promise<CreateUserResponse> {
    const res = await adminFetch('/admin/users', accessToken, {
        method: 'POST',
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));

        throw new Error((data as { message?: string }).message ?? 'Failed to create user');
    }

    return res.json();
}
