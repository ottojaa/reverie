/**
 * Builds the curl command that sends local files to an upload link. Pure text: the server never
 * reads the paths. Every path passes through two parsers, the shell and curl's own `-F` syntax.
 */

interface UploadCommand {
    url: string;
    secret: string;
    /** Absolute, or starting with `~/`. */
    paths: string[];
}

function toShellWord(text: string): string {
    return "'" + text.replace(/'/g, "'\\''") + "'";
}

/** Inside the quoted filename of `-F`, which keeps `;` and `,` literal, only backslash and `"` are special. */
function escapeForForm(path: string): string {
    return path.replace(/[\\"]/g, '\\$&');
}

/** The `file=@"…"` argument. A leading `~` is not expanded inside quotes, so it becomes `$HOME`. */
function toFileArgument(path: string): string {
    if (!path.startsWith('~/')) return toShellWord('file=@"' + escapeForForm(path) + '"');

    return toShellWord('file=@"') + '"$HOME"' + toShellWord(escapeForForm(path.slice(1)) + '"');
}

export function toUploadCommand({ url, secret, paths }: UploadCommand): string {
    return [
        // --form-escape: without it curl percent-encodes a `"` in a filename, and the file is stored under that name.
        'curl -sS --form-escape',
        '-H ' + toShellWord('X-Upload-Token: ' + secret),
        ...paths.map((path) => '-F ' + toFileArgument(path)),
        toShellWord(url),
    ].join(' ');
}
