import { useScrollContainer } from '@/lib/ScrollContainerContext';
import { useElementScrollRestoration, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

/**
 * The scroll offset of the page's scrolling area that the router remembered for this history entry (undefined when
 * there is none or `restore` is false), for a virtualizer to open at.
 *
 * The router puts that offset back and then scrolls the area to the top anyway (it counts only the window as restored,
 * and the area is listed in scrollToTopSelectors), so the offset is put back once more after that pass. Only the pass of
 * the navigation the list mounted in counts: a list that mounts after it (a skeleton came first) must not be pulled
 * back by a later navigation.
 */
export function useRestoredScroll(restore: boolean): number | undefined {
    const router = useRouter();
    const scrollContainerRef = useScrollContainer();
    const entry = useElementScrollRestoration({ id: 'main-scroll-area' });
    const offset = restore ? entry?.scrollY : undefined;

    useEffect(() => {
        if (offset === undefined) return;

        const mountedIn = router.state.location.state.__TSR_key;
        const unsubscribe = router.subscribe('onRendered', (event) => {
            unsubscribe();

            if (event.toLocation.state.__TSR_key !== mountedIn) return;

            scrollContainerRef.current?.scrollTo({ top: offset });
        });

        return unsubscribe;
        // Only the offset the page opened at: later renders must not pull the scroll back.
    }, []);

    return offset;
}
