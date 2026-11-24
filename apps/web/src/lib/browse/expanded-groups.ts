import { useCallback, useSyncExternalStore } from 'react';

const EMPTY: ReadonlySet<string> = new Set();

// The opened groups of each Recently added list, by scope ('library' or a folder id). They live outside the component so
// the list comes back as it was left after a trip to the viewer: the first render already has them, and the rows (and so
// the scroll height) are the same ones the router's remembered scroll position was taken in.
const openByScope = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);

    return () => listeners.delete(listener);
}

/** Flips one group of `scope` open or shut. */
export function toggleExpandedGroup(scope: string, key: string): void {
    const next = new Set(openByScope.get(scope) ?? EMPTY);

    if (next.has(key)) next.delete(key);
    else next.add(key);

    openByScope.set(scope, next);
    listeners.forEach((listener) => listener());
}

/** The keys of the groups currently open in `scope`. */
export function expandedGroups(scope: string): ReadonlySet<string> {
    return openByScope.get(scope) ?? EMPTY;
}

/** Forgets every opened group; for tests. */
export function resetExpandedGroups(): void {
    openByScope.clear();
    listeners.forEach((listener) => listener());
}

export function useExpandedGroups(scope: string) {
    const open = useSyncExternalStore(
        subscribe,
        () => expandedGroups(scope),
        () => EMPTY,
    );
    const toggle = useCallback((key: string) => toggleExpandedGroup(scope, key), [scope]);

    return { open, toggle };
}
