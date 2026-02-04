import {
    createContext,
    useCallback,
    useContext,
    useState,
    type ReactNode,
} from 'react';

interface SelectionContextValue {
    selectedIds: Set<string>;
    isSelected: (id: string) => boolean;
    toggle: (id: string) => void;
    select: (id: string) => void;
    deselect: (id: string) => void;
    clear: () => void;
    selectAll: (ids: string[]) => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function useSelection(): SelectionContextValue {
    const ctx = useContext(SelectionContext);
    if (!ctx) {
        throw new Error('useSelection must be used within SelectionProvider');
    }
    return ctx;
}

export function useSelectionOptional(): SelectionContextValue | null {
    return useContext(SelectionContext);
}

export function SelectionProvider({ children }: { children: ReactNode }) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const isSelected = useCallback(
        (id: string) => selectedIds.has(id),
        [selectedIds],
    );

    const toggle = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const select = useCallback((id: string) => {
        setSelectedIds((prev) => {
            if (prev.has(id)) return prev;
            const next = new Set(prev);
            next.add(id);
            return next;
        });
    }, []);

    const deselect = useCallback((id: string) => {
        setSelectedIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    }, []);

    const clear = useCallback(() => setSelectedIds(new Set()), []);

    const selectAll = useCallback((ids: string[]) => {
        setSelectedIds(new Set(ids));
    }, []);

    const value: SelectionContextValue = {
        selectedIds,
        isSelected,
        toggle,
        select,
        deselect,
        clear,
        selectAll,
    };

    return (
        <SelectionContext.Provider value={value}>
            {children}
        </SelectionContext.Provider>
    );
}
