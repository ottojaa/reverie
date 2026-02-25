import { Toaster } from '@/components/ui/sonner';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { AuthProvider } from './lib/auth';
import { ConfirmProvider } from './lib/confirm';
import { getQueryClient } from './lib/query-client/queryClient';
import { ThemeProvider } from './lib/theme';
import { router } from './router';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
    <StrictMode>
        <AuthProvider>
            <ThemeProvider>
                <QueryClientProvider client={getQueryClient()}>
                    <ConfirmProvider>
                        <Toaster />
                        <RouterProvider router={router} />
                    </ConfirmProvider>
                </QueryClientProvider>
            </ThemeProvider>
        </AuthProvider>
    </StrictMode>,
);
