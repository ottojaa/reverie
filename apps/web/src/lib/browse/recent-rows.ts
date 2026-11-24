import { documentKindOf, type Document } from '@reverie/shared';

/** What the Recently added list reads of a document. */
export type RecentDoc = Pick<Document, 'id' | 'created_at' | 'original_filename' | 'mime_type'>;

/** Neighbouring media uploaded within this long of each other fold into one row. */
export const FOLD_WINDOW_MILLIS = 10 * 60 * 1000;

/**
 * The most documents one fold holds. A camera-roll backup uploads thousands of photos seconds apart; unbounded, the
 * newest fold would swallow every page that loads and the list would never get a second row. Members are counted from
 * the newest, so a page that lands only fills the last fold or starts new ones below it, and nothing above moves.
 */
export const FOLD_MAX_MEMBERS = 30;

export type GroupKind = 'fold' | 'stack';

/**
 * One row of the Recently added list. A group holds several documents (newest first) behind one line: a fold of media
 * uploaded together, or a stack of files that share a name. A group's key is its newest member's id, so a page that
 * extends a group keeps its row.
 */
export type RecentRow<T extends RecentDoc = Document> =
    | { type: 'single'; key: string; doc: T }
    | { type: 'group'; key: string; groupKind: GroupKind; docs: T[] };

/** What the list draws: a row, or one member of an expanded group. */
export type RecentEntry<T extends RecentDoc = Document> =
    | { type: 'row'; key: string; row: RecentRow<T>; expanded: boolean }
    | { type: 'member'; key: string; doc: T; groupKey: string };

function isMedia(doc: RecentDoc): boolean {
    return documentKindOf(doc.mime_type) !== 'file';
}

function createdMillis(doc: RecentDoc): number | null {
    const millis = Date.parse(doc.created_at);

    return Number.isNaN(millis) ? null : millis;
}

function isChained(newer: RecentDoc, older: RecentDoc): boolean {
    if (!isMedia(newer) || !isMedia(older)) return false;

    const a = createdMillis(newer);
    const b = createdMillis(older);

    if (a === null || b === null) return false;

    return a - b >= 0 && a - b <= FOLD_WINDOW_MILLIS;
}

/** The folds (two or more chained media neighbours, at most FOLD_MAX_MEMBERS), keyed by the index each starts at. */
function foldRuns<T extends RecentDoc>(docs: T[]): Map<number, T[]> {
    const folds = new Map<number, T[]>();
    let start = 0;

    for (let i = 1; i <= docs.length; i++) {
        if (i < docs.length && isChained(docs[i - 1]!, docs[i]!)) continue;

        for (let at = start; at < i; at += FOLD_MAX_MEMBERS) {
            const chunk = docs.slice(at, Math.min(at + FOLD_MAX_MEMBERS, i));

            if (chunk.length > 1) folds.set(at, chunk);
        }

        start = i;
    }

    return folds;
}

function stacksByName<T extends RecentDoc>(docs: T[]): Map<string, T[]> {
    const byName = new Map<string, T[]>();

    for (const doc of docs) {
        if (isMedia(doc)) continue;

        const members = byName.get(doc.original_filename) ?? [];
        members.push(doc);
        byName.set(doc.original_filename, members);
    }

    return new Map([...byName].filter(([, members]) => members.length > 1));
}

/**
 * Folds and stacks `docs`, the loaded documents in upload order (newest first).
 *
 * Folding looks at raw neighbours only, so a document hidden inside a stack still separates the media on either side
 * of it, and a page that lands later can only extend the last group, never merge two groups above it. Stacking
 * collects every loaded file with exactly the same name into one row at the position of its newest copy; media never
 * stacks (camera names repeat without being versions).
 */
export function recentRows<T extends RecentDoc>(docs: T[]): RecentRow<T>[] {
    const folds = foldRuns(docs);
    const stacks = stacksByName(docs);
    const stacked = new Set<string>();
    const rows: RecentRow<T>[] = [];
    let index = 0;

    while (index < docs.length) {
        const fold = folds.get(index);

        if (fold) {
            rows.push({ type: 'group', key: fold[0]!.id, groupKind: 'fold', docs: fold });
            index += fold.length;
            continue;
        }

        const doc = docs[index++]!;
        const members = isMedia(doc) ? undefined : stacks.get(doc.original_filename);

        if (!members) {
            rows.push({ type: 'single', key: doc.id, doc });
            continue;
        }

        if (stacked.has(doc.original_filename)) continue;

        stacked.add(doc.original_filename);
        rows.push({ type: 'group', key: members[0]!.id, groupKind: 'stack', docs: members });
    }

    return rows;
}

/** `rows` with the groups whose key is in `expanded` opened into their members. */
export function recentEntries<T extends RecentDoc>(rows: RecentRow<T>[], expanded: ReadonlySet<string>): RecentEntry<T>[] {
    return rows.flatMap((row): RecentEntry<T>[] => {
        if (row.type === 'single') return [{ type: 'row', key: row.key, row, expanded: false }];

        const open = expanded.has(row.key);
        const entry: RecentEntry<T> = { type: 'row', key: row.key, row, expanded: open };

        if (!open) return [entry];

        return [entry, ...row.docs.map((doc): RecentEntry<T> => ({ type: 'member', key: `member:${doc.id}`, doc, groupKey: row.key }))];
    });
}

/**
 * The folder a group row shows: a stack is its newest copy's folder (as its size is); a fold is the folder all its
 * members share, or null when they sit in several (the row has no one folder to name).
 */
export function groupFolderId<T extends RecentDoc & { folder_id: string | null }>(row: Extract<RecentRow<T>, { type: 'group' }>): string | null {
    const first = row.docs[0]!.folder_id;

    if (row.groupKind === 'stack') return first;

    return row.docs.every((doc) => doc.folder_id === first) ? first : null;
}

/** The ids of the documents a row stands for: all the members of a group, the one document of a single. */
export function rowDocumentIds(row: RecentRow): string[] {
    return row.type === 'single' ? [row.doc.id] : row.docs.map((doc) => doc.id);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Day {
    year: number;
    month: number;
    day: number;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar day of `iso` in `timeZone` (the viewer's own by default), or null for an unparsable date. */
function dayOf(iso: string, timeZone: string | undefined): Day | null {
    const millis = Date.parse(iso);

    if (Number.isNaN(millis)) return null;

    const key = timeZone ?? '';
    const formatter = dayFormatters.get(key) ?? new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
    dayFormatters.set(key, formatter);

    const parts = formatter.formatToParts(new Date(millis));
    const part = (type: 'year' | 'month' | 'day') => Number(parts.find((p) => p.type === type)?.value);

    return { year: part('year'), month: part('month'), day: part('day') };
}

/** "Nov 6" within `todayYear`, "Nov 6, 2025" in any other year. */
function dayText(day: Day, todayYear: number): string {
    const text = `${MONTHS[day.month - 1]} ${day.day}`;

    return day.year === todayYear ? text : `${text}, ${day.year}`;
}

/** "Videos · Nov 6", "Photos and videos · Nov 9": the members' kind (no count) and the day of the newest. */
export function foldLabel(docs: RecentDoc[], today: Date = new Date(), timeZone?: string): string {
    const kinds = new Set(docs.map((doc) => documentKindOf(doc.mime_type)));
    const what = kinds.size === 1 && kinds.has('image') ? 'Photos' : kinds.size === 1 && kinds.has('video') ? 'Videos' : 'Photos and videos';
    const day = docs.length > 0 ? dayOf(docs[0]!.created_at, timeZone) : null;
    const now = dayOf(today.toISOString(), timeZone);

    if (!day || !now) return what;

    return `${what} · ${dayText(day, now.year)}`;
}

/** "Versions · Aug 19 – 25": the days the copies were uploaded across, oldest to newest. */
export function stackLabel(docs: RecentDoc[], today: Date = new Date(), timeZone?: string): string {
    const newest = docs.length > 0 ? dayOf(docs[0]!.created_at, timeZone) : null;
    const oldest = docs.length > 0 ? dayOf(docs[docs.length - 1]!.created_at, timeZone) : null;
    const now = dayOf(today.toISOString(), timeZone);

    if (!newest || !oldest || !now) return 'Versions';

    return `Versions · ${dayRange(oldest, newest, now.year)}`;
}

function dayRange(from: Day, to: Day, todayYear: number): string {
    if (from.year === to.year && from.month === to.month && from.day === to.day) return dayText(from, todayYear);

    // Across years both ends carry their year: a bare "Dec 28 – Jan 3" reads as one week.
    if (from.year !== to.year) return `${dayText(from, 0)} – ${dayText(to, 0)}`;

    if (from.month === to.month) return `${dayText(from, todayYear)} – ${to.day}`;

    return `${dayText(from, todayYear)} – ${MONTHS[to.month - 1]} ${to.day}`;
}
