import { Toaster } from '@/components/ui/sonner';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { LOCK_SETTINGS_ANCHOR } from './components/settings/LockSecretCard';
import { AuthProvider } from './lib/auth';
import { ConfirmProvider } from './lib/confirm';
import { getQueryClient } from './lib/query-client/queryClient';
import { ThemeProvider } from './lib/theme';
import { VaultProvider } from './lib/vault';
import { router } from './router';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

function openLockSettings() {
    void router.navigate({ to: '/settings', hash: LOCK_SETTINGS_ANCHOR });
}

root.render(
    <StrictMode>
        <AuthProvider>
            <ThemeProvider>
                <QueryClientProvider client={getQueryClient()}>
                    <VaultProvider onOpenLockSettings={openLockSettings}>
                        <ConfirmProvider>
                            <Toaster />
                            <RouterProvider router={router} />
                        </ConfirmProvider>
                    </VaultProvider>
                </QueryClientProvider>
            </ThemeProvider>
        </AuthProvider>
    </StrictMode>,
);
