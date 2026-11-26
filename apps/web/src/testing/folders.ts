import type { FolderWithChildren } from '@reverie/shared';

/** A public, empty top-level folder, with whatever the test needs changed. */
export function toTestFolder(id: string, overrides: Partial<FolderWithChildren> = {}): FolderWithChildren {
    return {
        id,
        parent_id: null,
        name: id,
        path: '/' + id,
        description: null,
        emoji: null,
        sort_order: 0,
        type: 'folder',
        is_private: false,
        lock_id: null,
        locked: false,
        document_count: 0,
        kind_counts: { image: 0, video: 0, file: 0 },
        cover: null,
        children: [],
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        ...overrides,
    } as FolderWithChildren;
}
