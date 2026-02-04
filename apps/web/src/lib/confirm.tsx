import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ButtonProps } from '@/components/ui/button';
import {
    createContext,
    useCallback,
    useContext,
    useRef,
    useState,
    type ReactNode,
} from 'react';

export interface ConfirmOptions {
    title: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    variant?: ButtonProps['variant'];
}

interface PendingConfirm extends ConfirmOptions {
    resolve: (value: boolean) => void;
}

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
    const confirmFn = useContext(ConfirmContext);
    if (!confirmFn) {
        throw new Error('useConfirm must be used within ConfirmProvider');
    }
    return confirmFn;
}

// Export for components that can't use hooks (e.g. context menu handlers that need confirm from callback)
let globalConfirm: (options: ConfirmOptions) => Promise<boolean> = () =>
    Promise.reject(new Error('ConfirmProvider not mounted'));

export function getConfirm(): (options: ConfirmOptions) => Promise<boolean> {
    return globalConfirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [pending, setPending] = useState<PendingConfirm | null>(null);
    const confirmedRef = useRef(false);

    const confirmFn = useCallback((options: ConfirmOptions) => {
        return new Promise<boolean>((resolve) => {
            setPending({
                ...options,
                resolve: (value) => {
                    setPending(null);
                    resolve(value);
                },
            });
            confirmedRef.current = false;
        });
    }, []);

    const handleOpenChange = useCallback(
        (open: boolean) => {
            if (!open && pending) {
                pending.resolve(confirmedRef.current);
                setPending(null);
            }
        },
        [pending],
    );

    const handleConfirm = useCallback(() => {
        confirmedRef.current = true;
    }, []);

    // Allow imperative getConfirm() for use outside React tree
    globalConfirm = confirmFn;

    return (
        <ConfirmContext.Provider value={confirmFn}>
            {children}
            <AlertDialog open={!!pending} onOpenChange={handleOpenChange}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
                        {pending?.description && (
                            <AlertDialogDescription>{pending.description}</AlertDialogDescription>
                        )}
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{pending?.cancelText ?? 'Cancel'}</AlertDialogCancel>
                        <AlertDialogAction
                            variant={pending?.variant ?? 'default'}
                            onClick={handleConfirm}
                        >
                            {pending?.confirmText ?? 'Confirm'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </ConfirmContext.Provider>
    );
}
