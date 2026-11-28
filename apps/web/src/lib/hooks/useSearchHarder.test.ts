// @vitest-environment jsdom
import { apiClient } from '@/lib/api/client';
import { ScrollContainerProvider } from '@/lib/ScrollContainerContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, settle } from '../../testing/render';
import { useSearchHarder, type SearchHarderState, type SearchHarderTarget } from './useSearchHarder';

const target: SearchHarderTarget = { q: 'receipt for the car', folderId: undefined, sortBy: 'relevance', sortOrder: 'desc' };
const answer = {
    data: { total: 0, results: [], query: { original: target.q, parsed: { text: target.q, filters: {} } }, timing_ms: 1 },
} as unknown as AxiosResponse;

const scrollTo = vi.fn();
const scrollContainer = { current: { scrollTo } as unknown as HTMLElement };

let client: QueryClient;
let state: SearchHarderState;
let view: ReturnType<typeof mount> | undefined;

function Probe({ target }: { target: SearchHarderTarget }) {
    state = useSearchHarder(target);

    return null;
}

function toPage(next: SearchHarderTarget) {
    const probe = createElement(ScrollContainerProvider, { value: scrollContainer }, createElement(Probe, { target: next }));

    return createElement(QueryClientProvider, { client }, probe);
}

function open(next: SearchHarderTarget = target) {
    view = mount(toPage(next));
}

async function show(next: SearchHarderTarget) {
    view!.render(toPage(next));
    await finish();
}

function leave() {
    view?.unmount();
    view = undefined;
}

/** A request that answers when the test says so. */
function holdAnswer() {
    let release: (response: AxiosResponse) => void = () => {};

    const held = new Promise<AxiosResponse>((resolve) => (release = resolve));
    const post = vi.spyOn(apiClient, 'post').mockReturnValue(held);

    return { post, release: () => release(answer) };
}

/** The query library reports on a timer of its own, which a zero wait can end ahead of on a busy machine. */
function finish() {
    return settle(10);
}

async function run() {
    state.run();
    await finish();
}

beforeEach(() => {
    client = new QueryClient();
    scrollTo.mockClear();
});

afterEach(() => {
    leave();
    client.clear();
    vi.restoreAllMocks();
});

describe('search harder', () => {
    it('asks only on run, with the query, the folder and today', async () => {
        const post = vi.spyOn(apiClient, 'post').mockResolvedValue(answer);
        open({ ...target, folderId: 'folder-1' });
        await finish();
        expect(post).not.toHaveBeenCalled();

        await run();

        expect(post.mock.calls).toEqual([['/search/harder', { q: target.q, folder_id: 'folder-1', today: expect.stringMatching(/^\d{4}-\d\d-\d\d$/) }]]);
        expect(state.results).toEqual([]);
    });

    it('shows the working state, then brings the answer into view', async () => {
        const held = holdAnswer();
        open();
        await run();
        expect(state.isRunning).toBe(true);
        expect(state.results).toBeUndefined();
        expect(scrollTo).not.toHaveBeenCalled();

        held.release();
        await finish();

        expect(state.isRunning).toBe(false);
        expect(state.results).toEqual([]);
        expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    });

    it('keeps the answer while the page is left and opened again, without asking twice', async () => {
        const post = vi.spyOn(apiClient, 'post').mockResolvedValue(answer);
        open();
        await run();
        leave();
        scrollTo.mockClear();

        open();
        await finish();

        expect(state.results).toEqual([]);
        expect(post).toHaveBeenCalledTimes(1);
        expect(scrollTo).not.toHaveBeenCalled();
    });

    it.each<[string, Partial<SearchHarderTarget>]>([
        ['query', { q: 'receipt for the boat' }],
        ['folder', { folderId: 'folder-2' }],
        ['sort', { sortBy: 'date' }],
        ['sort order', { sortOrder: 'asc' }],
    ])('drops the answer for good when the %s changes', async (_name, change) => {
        vi.spyOn(apiClient, 'post').mockResolvedValue(answer);
        open();
        await run();

        await show({ ...target, ...change });
        expect(state.results).toBeUndefined();

        await show(target);
        expect(state.results).toBeUndefined();
    });

    it.each<[string, string[]]>([
        ['anything that changes what search returns', ['search']],
        ['a delete', ['search', 'harder']],
    ])('drops the answer after %s, without asking again', async (_name, queryKey) => {
        const post = vi.spyOn(apiClient, 'post').mockResolvedValue(answer);
        open();
        await run();

        await client.invalidateQueries({ queryKey });
        await finish();

        expect(state.results).toBeUndefined();
        expect(post).toHaveBeenCalledTimes(1);

        await run();
        expect(state.results).toEqual([]);
    });

    it('drops the answer when the library changes while the page is closed, however long ago it was read', async () => {
        vi.spyOn(apiClient, 'post').mockResolvedValue(answer);
        open();
        await run();
        leave();

        await client.invalidateQueries({ queryKey: ['search'] });
        open();
        await finish();

        expect(state.results).toBeUndefined();
    });

    it('ignores an answer that arrives after the search changed', async () => {
        const held = holdAnswer();
        open();
        await run();
        await show({ ...target, q: 'something else' });
        held.release();
        await finish();
        await show(target);

        expect(state.results).toBeUndefined();
        expect(state.isRunning).toBe(false);
    });

    it.each([
        ['LLM_UNAVAILABLE', 503, true],
        ['SEARCH_PLAN_FAILED', 502, false],
    ])("shows the server's message for %s", async (code, status, isUnavailable) => {
        const response = { status, data: { error: code, message: 'No luck: ' + code }, statusText: '', headers: {}, config: { headers: new AxiosHeaders() } };
        vi.spyOn(apiClient, 'post').mockRejectedValue(new AxiosError('failed', undefined, undefined, undefined, response));
        open();
        await run();

        expect(state.errorMessage).toBe('No luck: ' + code);
        expect(state.isUnavailable).toBe(isUnavailable);
        expect(state.results).toBeUndefined();
    });
});
