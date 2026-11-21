import {
    CreateUserResponseSchema,
    EmbeddingStatusResponseSchema,
    ListServerSettingsResponseSchema,
    ListUsersResponseSchema,
    ServerSettingResponseSchema,
    TestLlmConnectionResponseSchema,
    UpdateUserResponseSchema,
    type CreateUserRequest,
    type CreateUserResponse,
    type EmbeddingStatusResponse,
    type ServerSetting,
    type TestLlmConnectionRequest,
    type TestLlmConnectionResponse,
    type UpdateServerSettingsRequest,
    type UpdateServerSettingRequest,
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

    async listSettings(): Promise<ServerSetting[]> {
        const { data } = await apiClient.get('/admin/settings');

        return ListServerSettingsResponseSchema.parse(data).settings;
    },

    async updateSetting(key: string, body: UpdateServerSettingRequest): Promise<ServerSetting> {
        const { data } = await apiClient.put(`/admin/settings/${encodeURIComponent(key)}`, body);

        return ServerSettingResponseSchema.parse(data).setting;
    },

    async resetSetting(key: string): Promise<ServerSetting> {
        const { data } = await apiClient.delete(`/admin/settings/${encodeURIComponent(key)}`);

        return ServerSettingResponseSchema.parse(data).setting;
    },

    /** Writes and resets several settings in one transaction; answers with the whole list. */
    async updateSettings(body: UpdateServerSettingsRequest): Promise<ServerSetting[]> {
        const { data } = await apiClient.put('/admin/settings', body);

        return ListServerSettingsResponseSchema.parse(data).settings;
    },

    async testLlmConnection(body: TestLlmConnectionRequest): Promise<TestLlmConnectionResponse> {
        const { data } = await apiClient.post('/admin/llm/test', body);

        return TestLlmConnectionResponseSchema.parse(data);
    },

    async getEmbeddingStatus(): Promise<EmbeddingStatusResponse> {
        const { data } = await apiClient.get('/admin/embeddings');

        return EmbeddingStatusResponseSchema.parse(data);
    },
};
