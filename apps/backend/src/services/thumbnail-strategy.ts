import { extname } from 'path';

/**
 * How a given file should be turned into a thumbnail image.
 *
 * - `image` / `pdf` / `video` — existing raster/render paths.
 * - `office`  — convert to PDF via headless LibreOffice, then render page 1.
 * - `text`    — render the file's first lines as a document-preview image.
 * - `none`    — no server thumbnail; clients show a file-type icon.
 *
 * This is the single gate + router for the thumbnail pipeline: `canGenerateThumbnail`
 * (upload) and `getImageBuffer` (worker) both derive their behaviour from it, so the
 * set of thumbnailable types can never drift between "was a job enqueued?" and "can the
 * worker render it?".
 */
export type ThumbnailStrategy = 'image' | 'pdf' | 'video' | 'office' | 'text' | 'none';

/** Office document extensions rendered via LibreOffice → PDF → first page. */
const OFFICE_EXTENSIONS = new Set([
    'doc',
    'docx',
    'dot',
    'xls',
    'xlsx',
    'xlsm',
    'xlt',
    'ppt',
    'pptx',
    'pot',
    'odt',
    'ods',
    'odp',
    'rtf',
]);

/**
 * Text/code/config extensions whose content is rendered directly to a preview image.
 * Extension is the reliable signal — browsers frequently report `text/plain` or
 * `application/octet-stream` for source files.
 */
const TEXT_EXTENSIONS = new Set([
    // plain text / docs
    'txt', 'text', 'md', 'markdown', 'mdx', 'rst', 'log', 'csv', 'tsv',
    // data / config
    'json', 'jsonc', 'json5', 'ndjson', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
    'xml', 'html', 'htm',
    // web / styles
    'css', 'scss', 'sass', 'less', 'vue', 'svelte',
    // scripts / languages
    'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts',
    'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp',
    'cs', 'php', 'swift', 'sh', 'bash', 'zsh', 'sql', 'graphql', 'gql',
    'dart', 'lua', 'pl', 'r', 'scala', 'clj', 'ex', 'exs', 'erl', 'hs', 'jl',
    'gradle', 'tex', 'bib', 'patch', 'diff',
]);

/** Extension-less filenames that are conventionally plain text. */
const TEXT_BASENAMES = new Set(['dockerfile', 'makefile', 'readme', 'license', 'licence', 'changelog', 'gitignore', 'gitattributes', 'npmrc', 'editorconfig']);

/** Application MIME types that are really text (not covered by the `text/` prefix). */
const TEXT_MIME_TYPES = new Set([
    'application/json',
    'application/ld+json',
    'application/xml',
    'application/xhtml+xml',
    'application/yaml',
    'application/x-yaml',
    'application/javascript',
    'application/typescript',
    'application/x-sh',
    'application/x-httpd-php',
    'application/sql',
]);

/** Lowercase extension without the leading dot (e.g. `docx`), or `''` if none. */
export function getExtension(filename: string): string {
    return extname(filename).slice(1).toLowerCase();
}

function isOffice(mimeType: string, ext: string): boolean {
    if (OFFICE_EXTENSIONS.has(ext)) return true;

    return (
        mimeType === 'application/msword' ||
        mimeType === 'application/rtf' ||
        mimeType === 'text/rtf' ||
        mimeType.startsWith('application/vnd.ms-') ||
        mimeType.startsWith('application/vnd.openxmlformats-officedocument') ||
        mimeType.startsWith('application/vnd.oasis.opendocument')
    );
}

function isText(mimeType: string, ext: string, filename: string): boolean {
    if (ext) return TEXT_EXTENSIONS.has(ext);

    // No extension — fall back to MIME, then to conventional basenames (Dockerfile, Makefile…).
    if (mimeType.startsWith('text/') || TEXT_MIME_TYPES.has(mimeType)) return true;

    return TEXT_BASENAMES.has(filename.toLowerCase());
}

/**
 * Decide how (or whether) to build a thumbnail for a file, using both MIME and filename.
 */
export function getThumbnailStrategy(mimeType: string, filename: string): ThumbnailStrategy {
    // image/* includes image/svg+xml — sharp rasterises SVG markup directly.
    if (mimeType.startsWith('image/')) return 'image';

    if (mimeType === 'application/pdf') return 'pdf';

    if (mimeType.startsWith('video/')) return 'video';

    if (mimeType.startsWith('audio/')) return 'none';

    const ext = getExtension(filename);

    if (isOffice(mimeType, ext)) return 'office';

    // Prefer MIME over extension for text so a well-typed file wins even with an odd name.
    if (mimeType.startsWith('text/') || TEXT_MIME_TYPES.has(mimeType)) return 'text';

    if (isText(mimeType, ext, filename)) return 'text';

    return 'none';
}
