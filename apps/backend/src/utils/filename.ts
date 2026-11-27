/** The name before the last dot, and the rest with its dot: `.hidden` is all extension, `README` has none. */
function splitExtension(filename: string): { base: string; ext: string } {
    const lastDot = filename.lastIndexOf('.');

    if (lastDot < 0) return { base: filename, ext: '' };

    return { base: filename.slice(0, lastDot), ext: filename.slice(lastDot) };
}

const toLikeLiteral = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/**
 * A SQL LIKE pattern (default escape character) matching every numbered copy `getDeduplicatedFilename` could give
 * `filename`. It may match more, such as `a (old).txt`: those names are never candidates.
 */
export function toNumberedCopyPattern(filename: string): string {
    const { base, ext } = splitExtension(filename);

    return toLikeLiteral(base) + ' (%)' + toLikeLiteral(ext);
}

/**
 * Returns a filename that does not exist in existingFilenames, by appending (n) before the extension.
 * E.g. "accounts.csv" -> "accounts (1).csv" if "accounts.csv" exists.
 */
export function getDeduplicatedFilename(existingFilenames: string[], filename: string): string {
    const existingSet = new Set(existingFilenames);

    if (!existingSet.has(filename)) {
        return filename;
    }

    const { base, ext } = splitExtension(filename);

    for (let n = 1; ; n++) {
        const candidate = `${base} (${n})${ext}`;

        if (!existingSet.has(candidate)) {
            return candidate;
        }
    }
}
