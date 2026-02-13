import { useLocation } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

/**
 * Module-level tracking of the pathname for the currently rendered route.
 * Updated after each render by `usePathnameTracker` (which lives in Layout).
 *
 * Because effects run *after* render, a `useState` initializer during the
 * render phase still sees the value from the *previous* navigation —
 * exactly the page the user navigated away from.
 */
let _currentPathname = '';

/**
 * Keeps `_currentPathname` in sync with route changes.
 * Must be called once in a component that never unmounts (Layout).
 */
export function usePathnameTracker() {
    const { pathname } = useLocation();

    useEffect(() => {
        _currentPathname = pathname;
    }, [pathname]);
}

/**
 * Returns `true` when the current page was reached from a `/document/*` page
 * (i.e. back-navigation between documents, or from doc → browse).
 *
 * Works for both browser back button and in-app back button.
 * Uses TanStack Router's `useLocation` — no raw browser APIs.
 */
export function useIsReturningFromDocument(): boolean {
    return useState(() => _currentPathname.startsWith('/document/'))[0];
}
