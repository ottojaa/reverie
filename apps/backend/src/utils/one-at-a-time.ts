interface Waiters {
    ahead: (() => void)[];
    yielding: (() => void)[];
}

/** Present while a task holds the key. */
const queues = new Map<string, Waiters>();

/**
 * Runs `task` once no other task given the same key is running. Tasks wait their turn in the order they came, except
 * that one that `yields` goes only when no task that doesn't is waiting. Holds within this process only.
 */
export async function oneAtATime<T>(key: string, task: () => Promise<T>, { yields = false } = {}): Promise<T> {
    await takeTurn(key, yields);

    try {
        return await task();
    } finally {
        passTurn(key);
    }
}

function takeTurn(key: string, yields: boolean): Promise<void> {
    const queue = queues.get(key);

    if (!queue) {
        queues.set(key, { ahead: [], yielding: [] });

        return Promise.resolve();
    }

    return new Promise((start) => (yields ? queue.yielding : queue.ahead).push(start));
}

function passTurn(key: string): void {
    const queue = queues.get(key)!;
    const next = queue.ahead.shift() ?? queue.yielding.shift();

    if (next) return next();

    queues.delete(key);
}
