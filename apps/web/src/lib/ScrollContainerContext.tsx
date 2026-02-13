import { createContext, useContext, type RefObject } from 'react';

const ScrollContainerContext = createContext<RefObject<HTMLElement | null> | null>(null);

export const ScrollContainerProvider = ScrollContainerContext.Provider;

export function useScrollContainer(): RefObject<HTMLElement | null> {
    const ref = useContext(ScrollContainerContext);

    if (!ref) {
        throw new Error('useScrollContainer must be used within a ScrollContainerProvider');
    }

    return ref;
}
