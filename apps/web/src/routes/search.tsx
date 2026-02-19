import { createFileRoute } from '@tanstack/react-router';
import { SearchPage } from '../pages/Search';

export const Route = createFileRoute('/search')({
    validateSearch: (search?: { q?: string; sort_by?: string; sort_order?: string } | undefined) => ({
        q: (search?.q as string) ?? '',
        sort_by: (search?.sort_by as string) ?? 'relevance',
        sort_order: (search?.sort_order as string) ?? 'desc',
    }),
    component: SearchPage,
});
