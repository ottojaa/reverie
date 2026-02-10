import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface SelectionContextValue {
    selectedIds: Set<string>;
    /** Last item selected by a primary (non-shift, non-ctrl) click; used for shift+click range */
    anchorId: string | null;
    isSelected: (id: string) => boolean;
    toggle: (id: string) => void;
    select: (id: string) => void;
    deselect: (id: string) => void;
    clear: () => void;
    selectAll: (ids: string[]) => void;
    selectMany: (ids: string[]) => void;
    /** Replace selection with a single id and set it as the range anchor */
    selectOnly: (id: string) => void;
    /** Select range from anchor to endId (inclusive) using orderedIds for order */
    selectRange: (anchorId: string, endId: string, orderedIds: string[]) => void;
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
    const [anchorId, setAnchorId] = useState<string | null>(null);

    const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

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

    const selectMany = useCallback((ids: string[]) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.add(id));

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

    const clear = useCallback(() => {
        setSelectedIds(new Set());
        setAnchorId(null);
    }, []);

    const selectAll = useCallback((ids: string[]) => {
        setSelectedIds(new Set(ids));
    }, []);

    const selectOnly = useCallback((id: string) => {
        setSelectedIds(new Set([id]));
        setAnchorId(id);
    }, []);

    const selectRange = useCallback((anchor: string, endId: string, orderedIds: string[]) => {
        const a = orderedIds.indexOf(anchor);
        const b = orderedIds.indexOf(endId);

        if (a === -1 || b === -1) return;

        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const range = orderedIds.slice(lo, hi + 1);
        setSelectedIds(new Set(range));
    }, []);

    const value: SelectionContextValue = {
        selectedIds,
        anchorId,
        isSelected,
        toggle,
        select,
        deselect,
        clear,
        selectMany,
        selectAll,
        selectOnly,
        selectRange,
    };

    return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
