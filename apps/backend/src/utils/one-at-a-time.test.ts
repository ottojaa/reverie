import { describe, expect, it } from 'vitest';
import { oneAtATime } from './one-at-a-time';

/** Tasks that record when they start and end only when released. */
function createTasks() {
    const started: string[] = [];
    const releases = new Map<string, () => void>();

    const run = (name: string, key = 'key', options?: { yields: boolean }) =>
        oneAtATime(
            key,
            () => {
                started.push(name);

                return new Promise<string>((resolve) => releases.set(name, () => resolve(name)));
            },
            options,
        );

    const release = async (name: string) => {
        releases.get(name)!();
        await new Promise((resolve) => setImmediate(resolve));
    };

    const settle = () => new Promise((resolve) => setImmediate(resolve));

    return { started, run, release, settle };
}

describe('oneAtATime', () => {
    it('runs the tasks of a key one at a time, in the order they came', async () => {
        const { started, run, release, settle } = createTasks();
        const all = Promise.all([run('first'), run('second'), run('third')]);
        await settle();

        expect(started).toEqual(['first']);
        await release('first');
        expect(started).toEqual(['first', 'second']);
        await release('second');
        await release('third');

        expect(await all).toEqual(['first', 'second', 'third']);
    });

    it('does not make tasks of different keys wait for each other', async () => {
        const { started, run, release, settle } = createTasks();
        const all = Promise.all([run('a', 'a'), run('b', 'b')]);
        await settle();

        expect(started).toEqual(['a', 'b']);
        await release('a');
        await release('b');
        await all;
    });

    it('lets a task that yields go only when no other kind is waiting, however long it has waited', async () => {
        const { started, run, release, settle } = createTasks();
        const all = Promise.all([
            run('running', 'key', { yields: true }),
            run('yields first', 'key', { yields: true }),
            run('yields second', 'key', { yields: true }),
            run('later'),
        ]);
        await settle();

        await release('running');
        await release('later');
        await release('yields first');
        await release('yields second');
        await all;

        expect(started).toEqual(['running', 'later', 'yields first', 'yields second']);
    });

    it('passes the turn on after a task fails, and starts afresh once none is waiting', async () => {
        const failed = oneAtATime('failing', async () => {
            throw new Error('Task failed: test');
        });
        const next = oneAtATime('failing', async () => 'next');

        await expect(failed).rejects.toThrow('Task failed: test');
        expect(await next).toBe('next');
        expect(await oneAtATime('failing', async () => 'again')).toBe('again');
    });
});
