import { createFileRoute } from '@tanstack/react-router';
import { CanvasPage } from '../components/canvas/CanvasPage';

export const Route = createFileRoute('/canvas')({
    validateSearch: (search?: { focus?: string } | undefined): { focus?: string } => ({
        ...(search?.focus ? { focus: search.focus as string } : {}),
    }),
    component: CanvasPage,
});
