/**
 * Returns a filename that does not exist in existingFilenames, by appending (n) before the extension.
 * E.g. "accounts.csv" -> "accounts (1).csv" if "accounts.csv" exists.
 */
export function getDeduplicatedFilename(existingFilenames: string[], filename: string): string {
    const existingSet = new Set(existingFilenames);

    if (!existingSet.has(filename)) {
        return filename;
    }

    const lastDot = filename.lastIndexOf('.');

    const base = lastDot >= 0 ? filename.slice(0, lastDot) : filename;
    const ext = lastDot >= 0 ? filename.slice(lastDot) : '';

    for (let n = 1; ; n++) {
        const candidate = `${base} (${n})${ext}`;

        if (!existingSet.has(candidate)) {
            return candidate;
        }
    }
}
