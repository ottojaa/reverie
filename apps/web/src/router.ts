import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export const router = createRouter({ routeTree });

/* eslint-disable no-unused-vars -- interface augmentation */
declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
