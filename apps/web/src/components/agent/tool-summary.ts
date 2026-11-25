import type { AgentToolItem } from '@reverie/shared';

/** What a tool call did, in a line, for the compact row. Reads the registry's own result shapes. */

type Fields = Record<string, unknown>;

function toFields(value: unknown): Fields {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Fields) : {};
}

function toNumber(value: unknown): number {
    return typeof value === 'number' ? value : 0;
}

function toText(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function plural(count: number, noun: string): string {
    return count + ' ' + noun + (count === 1 ? '' : 's');
}

export function toToolLabel(name: string): string {
    const text = name.replace(/_/g, ' ');

    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A result with a `dry_run` field came from a write tool. */
export function isWriteResult(output: unknown): boolean {
    return typeof toFields(output).dry_run === 'boolean';
}

/** Undo is offered for applied writes that have an audit row; undoing an undo is not possible. */
export function canUndo(tool: AgentToolItem): boolean {
    return tool.status === 'done' && tool.name !== 'undo_write' && tool.applied === true && !!tool.audit_id;
}

function describeMove(out: Fields): string {
    const target = toText(toFields(out.target).path);

    return (
        `Moved ${plural(toNumber(out.moved), 'document')} to ${target || 'a folder'}` +
        (toNumber(out.already_there) > 0 ? `, ${toNumber(out.already_there)} already there` : '')
    );
}

function describeWrite(name: string, out: Fields): string | null {
    switch (name) {
        case 'move_documents':
            return describeMove(out);
        case 'rename_document':
        case 'rename_folder':
            return `Renamed "${toText(out.from)}" to "${toText(out.to)}"`;
        case 'create_folder':
            return `Created folder ${toText(out.path)}`;
        case 'add_tags':
            return `Added ${plural(toNumber(out.tags_added), 'tag')} to ${plural(toNumber(out.documents_changed), 'document')}`;
        case 'remove_tags':
            return `Removed ${plural(toNumber(out.tags_removed), 'tag')} from ${plural(toNumber(out.documents_changed), 'document')}`;
        case 'undo_write':
            return `Undid ${toText(out.undoes).replace(/_/g, ' ') || 'a change'}`;
        default:
            return null;
    }
}

/** Sample filenames the write touched, when the tool reports them. */
export function toSampleNames(output: unknown): string[] {
    const sample = toFields(output).sample;

    if (!Array.isArray(sample)) return [];

    return sample.flatMap((entry) => {
        const name = toText(toFields(entry).filename);

        return name ? [name] : [];
    });
}

export function toToolSummary(tool: AgentToolItem): string {
    if (tool.status === 'running') return 'Working…';

    const out = toFields(tool.output);

    if (tool.status === 'error') return toText(out.error) || 'The tool failed';

    if (!isWriteResult(tool.output)) return toReadSummary(out);

    if (out.dry_run === true) return 'Preview only, nothing changed';

    if (out.applied === false) return toText(out.note) || 'Nothing to change';

    return describeWrite(tool.name, out) ?? 'Change applied';
}

function toReadSummary(out: Fields): string {
    const total = out.total ?? out.count;

    if (typeof total === 'number') return plural(total, 'result');

    return 'Done';
}
