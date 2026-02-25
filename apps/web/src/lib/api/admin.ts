import {
    CreateUserResponseSchema,
    ListUsersResponseSchema,
    UpdateUserResponseSchema,
    type CreateUserRequest,
    type CreateUserResponse,
    type UpdateUserRequest,
    type User,
} from '@reverie/shared';
import { apiClient } from './client';

export const adminApi = {
    async listUsers(): Promise<User[]> {
        const { data } = await apiClient.get('/admin/users');

        return ListUsersResponseSchema.parse(data).users;
    },

    async updateUser(userId: string, body: UpdateUserRequest): Promise<User> {
        const { data } = await apiClient.patch(`/admin/users/${userId}`, body);

        return UpdateUserResponseSchema.parse(data).user;
    },

    async createUser(body: CreateUserRequest): Promise<CreateUserResponse> {
        const { data } = await apiClient.post('/admin/users', body);

        return CreateUserResponseSchema.parse(data);
    },

    async deleteUser(userId: string): Promise<void> {
        await apiClient.delete(`/admin/users/${userId}`);
    },
};
