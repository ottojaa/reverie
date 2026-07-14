/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import path from 'path';

export default defineConfig(() => ({
    resolve: {
        alias: {
            '@': path.resolve(import.meta.dirname, './src'),
        },
    },
    root: import.meta.dirname,
    cacheDir: '../../node_modules/.vite/apps/web',
    server: {
        port: 4200,
        host: 'localhost',
    },
    preview: {
        port: 4200,
        host: 'localhost',
    },
    plugins: [tailwindcss(), TanStackRouterVite({ target: 'react', autoCodeSplitting: true }), react()],
    optimizeDeps: {
        // Pre-bundle the per-icon dynamic imports (~1600 chunks) at startup; discovering them
        // mid-session triggers a dep re-optimization that 504s already-loaded modules.
        include: ['lucide-react/dynamic'],
    },
    build: {
        outDir: './dist',
        emptyOutDir: true,
        reportCompressedSize: true,
        commonjsOptions: {
            transformMixedEsModules: true,
        },
    },
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
}));
