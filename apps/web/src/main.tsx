import { Toaster } from '@/components/ui/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { AuthProvider } from './lib/auth';
import { ConfirmProvider } from './lib/confirm';
import { ThemeProvider } from './lib/theme';
import { router } from './router';
import './styles.css';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5, // 5 minutes
            retry: 1,
        },
    },
});

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
    <StrictMode>
        <AuthProvider>
            <ThemeProvider>
                <QueryClientProvider client={queryClient}>
                    <ConfirmProvider>
                        <Toaster />
                        <RouterProvider router={router} />
                    </ConfirmProvider>
                </QueryClientProvider>
            </ThemeProvider>
        </AuthProvider>
    </StrictMode>,
);
