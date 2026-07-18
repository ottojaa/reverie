import { cn } from '@/lib/utils';
import { File, FileArchive, FileAudio, FileCode, FileCog, FileImage, FileJson, FileSpreadsheet, FileText, FileType, FileVideo, Presentation, type LucideIcon } from 'lucide-react';

/**
 * File type configuration with icon and colors
 */
interface FileTypeConfig {
    icon: LucideIcon;
    color: string;
    bgColor: string;
    label: string;
}

// Named configs. Colors are static class strings (Tailwind can't build class names
// from template literals), reused across the extension map below.
const CONFIGS = {
    word: { icon: FileText, color: 'text-blue-600', bgColor: 'bg-blue-600/10', label: 'Document' },
    pdf: { icon: FileText, color: 'text-red-500', bgColor: 'bg-red-500/10', label: 'PDF' },
    sheet: { icon: FileSpreadsheet, color: 'text-emerald-600', bgColor: 'bg-emerald-600/10', label: 'Spreadsheet' },
    slides: { icon: Presentation, color: 'text-orange-500', bgColor: 'bg-orange-500/10', label: 'Presentation' },
    markdown: { icon: FileText, color: 'text-slate-500', bgColor: 'bg-slate-500/10', label: 'Markdown' },
    text: { icon: FileText, color: 'text-gray-500', bgColor: 'bg-gray-500/10', label: 'Text' },
    json: { icon: FileJson, color: 'text-amber-500', bgColor: 'bg-amber-500/10', label: 'Data' },
    config: { icon: FileCog, color: 'text-gray-500', bgColor: 'bg-gray-500/10', label: 'Config' },
    code: { icon: FileCode, color: 'text-violet-500', bgColor: 'bg-violet-500/10', label: 'Code' },
    web: { icon: FileCode, color: 'text-orange-600', bgColor: 'bg-orange-600/10', label: 'Markup' },
    style: { icon: FileCode, color: 'text-sky-500', bgColor: 'bg-sky-500/10', label: 'Stylesheet' },
    archive: { icon: FileArchive, color: 'text-yellow-600', bgColor: 'bg-yellow-600/10', label: 'Archive' },
    audio: { icon: FileAudio, color: 'text-green-500', bgColor: 'bg-green-500/10', label: 'Audio' },
    video: { icon: FileVideo, color: 'text-purple-500', bgColor: 'bg-purple-500/10', label: 'Video' },
    image: { icon: FileImage, color: 'text-blue-500', bgColor: 'bg-blue-500/10', label: 'Image' },
    font: { icon: FileType, color: 'text-pink-500', bgColor: 'bg-pink-500/10', label: 'Font' },
    binary: { icon: FileCog, color: 'text-gray-400', bgColor: 'bg-gray-400/10', label: 'Binary' },
    generic: { icon: File, color: 'text-gray-400', bgColor: 'bg-gray-400/10', label: 'File' },
} satisfies Record<string, FileTypeConfig>;

/** Per-extension icon/color for the ~50 most common file types. Keyed lowercase, no dot. */
const EXTENSION_CONFIG: Record<string, FileTypeConfig> = {
    // documents
    doc: CONFIGS.word, docx: CONFIGS.word, odt: CONFIGS.word, rtf: CONFIGS.word, pages: CONFIGS.word,
    pdf: CONFIGS.pdf,
    // spreadsheets
    xls: CONFIGS.sheet, xlsx: CONFIGS.sheet, xlsm: CONFIGS.sheet, ods: CONFIGS.sheet, numbers: CONFIGS.sheet, csv: CONFIGS.sheet, tsv: CONFIGS.sheet,
    // presentations
    ppt: CONFIGS.slides, pptx: CONFIGS.slides, odp: CONFIGS.slides, key: CONFIGS.slides,
    // text / markdown
    md: CONFIGS.markdown, markdown: CONFIGS.markdown, mdx: CONFIGS.markdown, rst: CONFIGS.markdown,
    txt: CONFIGS.text, log: CONFIGS.text,
    // data / config
    json: CONFIGS.json, jsonc: CONFIGS.json, json5: CONFIGS.json, ndjson: CONFIGS.json,
    yaml: CONFIGS.config, yml: CONFIGS.config, toml: CONFIGS.config, ini: CONFIGS.config, conf: CONFIGS.config, cfg: CONFIGS.config, env: CONFIGS.config, properties: CONFIGS.config,
    // markup / web / styles
    xml: CONFIGS.web, html: CONFIGS.web, htm: CONFIGS.web, svg: CONFIGS.web, vue: CONFIGS.web, svelte: CONFIGS.web,
    css: CONFIGS.style, scss: CONFIGS.style, sass: CONFIGS.style, less: CONFIGS.style,
    // code
    js: CONFIGS.code, mjs: CONFIGS.code, cjs: CONFIGS.code, jsx: CONFIGS.code, ts: CONFIGS.code, tsx: CONFIGS.code,
    py: CONFIGS.code, rb: CONFIGS.code, go: CONFIGS.code, rs: CONFIGS.code, java: CONFIGS.code, kt: CONFIGS.code, kts: CONFIGS.code,
    c: CONFIGS.code, h: CONFIGS.code, cpp: CONFIGS.code, cc: CONFIGS.code, hpp: CONFIGS.code, cs: CONFIGS.code, php: CONFIGS.code, swift: CONFIGS.code,
    sh: CONFIGS.code, bash: CONFIGS.code, zsh: CONFIGS.code, sql: CONFIGS.code, graphql: CONFIGS.code, gql: CONFIGS.code,
    // archives
    zip: CONFIGS.archive, rar: CONFIGS.archive, '7z': CONFIGS.archive, tar: CONFIGS.archive, gz: CONFIGS.archive, tgz: CONFIGS.archive, bz2: CONFIGS.archive, xz: CONFIGS.archive,
    // audio
    mp3: CONFIGS.audio, wav: CONFIGS.audio, flac: CONFIGS.audio, ogg: CONFIGS.audio, m4a: CONFIGS.audio, aac: CONFIGS.audio,
    // video
    mp4: CONFIGS.video, mov: CONFIGS.video, webm: CONFIGS.video, avi: CONFIGS.video, mkv: CONFIGS.video, m4v: CONFIGS.video,
    // images
    jpg: CONFIGS.image, jpeg: CONFIGS.image, png: CONFIGS.image, gif: CONFIGS.image, webp: CONFIGS.image, bmp: CONFIGS.image, tiff: CONFIGS.image, heic: CONFIGS.image, heif: CONFIGS.image, ico: CONFIGS.image,
    // fonts
    ttf: CONFIGS.font, otf: CONFIGS.font, woff: CONFIGS.font, woff2: CONFIGS.font,
    // binaries
    exe: CONFIGS.binary, bin: CONFIGS.binary, dmg: CONFIGS.binary, iso: CONFIGS.binary, apk: CONFIGS.binary,
};

/**
 * Get file type configuration. Prefers the file extension (when a filename is given)
 * so we get a specific icon/color for the ~50 common types; falls back to MIME buckets.
 */
export function getFileTypeConfig(mimeType: string, filename?: string): FileTypeConfig {
    const ext = filename ? getFileExtension(filename).toLowerCase() : '';

    if (ext && EXTENSION_CONFIG[ext]) return EXTENSION_CONFIG[ext];

    if (mimeType.startsWith('image/')) return CONFIGS.image;

    if (mimeType === 'application/pdf') return CONFIGS.pdf;

    if (mimeType.startsWith('video/')) return CONFIGS.video;

    if (mimeType.startsWith('audio/')) return CONFIGS.audio;

    if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv' || mimeType === 'application/vnd.ms-excel') return CONFIGS.sheet;

    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return CONFIGS.slides;

    if (mimeType.includes('word') || mimeType === 'application/msword' || mimeType.includes('wordprocessingml')) return CONFIGS.word;

    if (mimeType.startsWith('text/') || mimeType.includes('javascript') || mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('html')) return CONFIGS.code;

    if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('7z') || mimeType.includes('gzip')) return CONFIGS.archive;

    return CONFIGS.generic;
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
    const parts = filename.split('.');

    if (parts.length > 1) {
        const last = parts[parts.length - 1];

        return last !== undefined ? last.toUpperCase() : '';
    }

    return '';
}

interface FileTypeIconProps {
    mimeType: string;
    /** When provided, the extension selects a more specific icon/color than MIME alone. */
    filename?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    showBackground?: boolean;
    className?: string;
}

const sizeClasses = {
    sm: 'size-4',
    md: 'size-6',
    lg: 'size-8',
    xl: 'size-12',
};

const bgSizeClasses = {
    sm: 'p-1',
    md: 'p-2',
    lg: 'p-3',
    xl: 'p-4',
};

export function FileTypeIcon({ mimeType, filename, size = 'md', showBackground = false, className }: FileTypeIconProps) {
    const config = getFileTypeConfig(mimeType, filename);
    const Icon = config.icon;

    if (showBackground) {
        return (
            <div className={cn('rounded-lg', config.bgColor, bgSizeClasses[size], className)}>
                <Icon className={cn(sizeClasses[size], config.color)} />
            </div>
        );
    }

    return <Icon className={cn(sizeClasses[size], config.color, className)} />;
}
