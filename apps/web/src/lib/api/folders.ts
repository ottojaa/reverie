import {
    FolderSchema,
    FolderTreeResponseSchema,
    type Folder,
    type FolderWithChildren,
} from '@reverie/shared';
import { apiClient } from './client';

export const foldersApi = {
    async getTree(): Promise<FolderWithChildren[]> {
        const { data } = await apiClient.get('/folders/tree');

        return FolderTreeResponseSchema.parse(data);
    },

    async reorder(updates: Array<{ id: string; sort_order: number }>): Promise<void> {
        await apiClient.put('/folders/reorder', { updates });
    },

    async create(data: {
        name: string;
        parent_id?: string;
        description?: string;
        emoji?: string;
        type?: 'collection' | 'folder';
    }): Promise<Folder> {
        const { data: folder } = await apiClient.post('/folders', data);

        return FolderSchema.parse(folder);
    },

    async get(id: string): Promise<Folder> {
        const { data } = await apiClient.get(`/folders/${id}`);

        return FolderSchema.parse(data);
    },

    async patch(
        id: string,
        data: { name?: string; description?: string | null; emoji?: string | null; parent_id?: string | null },
    ): Promise<Folder> {
        const { data: folder } = await apiClient.patch(`/folders/${id}`, data);

        return FolderSchema.parse(folder);
    },

    async delete(id: string): Promise<void> {
        await apiClient.delete(`/folders/${id}`);
    },
};
