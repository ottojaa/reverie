import type { ParsedQuery, DateRange } from '@reverie/shared';

/**
 * Query Parser for Advanced Search
 *
 * Parses user query syntax into structured ParsedQuery object.
 *
 * Supported syntax:
 * - Free text: "beach sunset" or beach sunset
 * - Scoped text: in:filename vacation, in:content Apple
 * - Filters: type:photo, format:pdf, category:receipt
 * - Dates: uploaded:2024, uploaded:last-week, date:2022-2025
 * - Folder: folder:/vacation/2024, folder:receipts
 * - Properties: has:text, has:summary, -has:thumbnail
 * - Size: size:>1MB, size:<100KB
 * - Entities: entity:Apple, company:"John Smith"
 * - Tags: tag:important, tag:tax
 * - Negation: -has:text, -type:photo
 */

// Token types
interface Token {
    type: 'text' | 'quoted' | 'filter';
    value: string;
    key?: string;
    negated?: boolean;
}

// Size units
const SIZE_UNITS: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
};

// Relative date mappings
const RELATIVE_DATES: Record<string, DateRange['relative']> = {
    today: 'today',
    yesterday: 'yesterday',
    'last-week': 'last-week',
    'last-month': 'last-month',
    'last-year': 'last-year',
};

// Type aliases (what users type -> internal category)
const TYPE_ALIASES: Record<string, string[]> = {
    photo: ['photo'],
    photos: ['photo'],
    image: ['photo'],
    images: ['photo'],
    document: ['document', 'stock_overview', 'stock_split', 'dividend_statement', 'transaction_receipt'],
    documents: ['document', 'stock_overview', 'stock_split', 'dividend_statement', 'transaction_receipt'],
    doc: ['document', 'stock_overview', 'stock_split', 'dividend_statement', 'transaction_receipt'],
    receipt: ['transaction_receipt'],
    receipts: ['transaction_receipt'],
    screenshot: ['screenshot'],
    screenshots: ['screenshot'],
};

/**
 * Tokenize the query string into parts
 */
function tokenize(query: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const chars = Array.from(query); // Convert to array for safer indexing

    while (i < chars.length) {
        // Skip whitespace
        while (i < chars.length && /\s/.test(chars[i] ?? '')) {
            i++;
        }
        if (i >= chars.length) break;

        // Check for negation
        const negated = chars[i] === '-';
        if (negated) i++;

        // Check for quoted string
        if (chars[i] === '"') {
            i++; // Skip opening quote
            let value = '';
            while (i < chars.length && chars[i] !== '"') {
                value += chars[i] ?? '';
                i++;
            }
            i++; // Skip closing quote
            tokens.push({ type: 'quoted', value, negated });
            continue;
        }

        // Read until whitespace or end
        let word = '';
        while (i < chars.length && !/\s/.test(chars[i] ?? '')) {
            word += chars[i] ?? '';
            i++;
        }

        // Check if it's a filter (key:value)
        const colonIndex = word.indexOf(':');
        if (colonIndex > 0) {
            const key = word.slice(0, colonIndex).toLowerCase();
            let value = word.slice(colonIndex + 1);

            // Handle quoted values in filters like entity:"John Smith"
            if (value.startsWith('"') && !value.endsWith('"')) {
                // Read until closing quote
                value = value.slice(1); // Remove opening quote
                while (i < chars.length && chars[i - 1] !== '"') {
                    const currentChar = chars[i] ?? '';
                    if (/\s/.test(currentChar)) {
                        value += currentChar;
                        i++;
                    } else {
                        // Continue reading the word
                        while (i < chars.length && !/\s/.test(chars[i] ?? '') && chars[i] !== '"') {
                            value += chars[i] ?? '';
                            i++;
                        }
                        if (chars[i] === '"') {
                            i++; // Skip closing quote
                            break;
                        }
                    }
                }
            } else if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1); // Remove quotes
            }

            tokens.push({ type: 'filter', key, value, negated });
        } else {
            tokens.push({ type: 'text', value: word, negated });
        }
    }

    return tokens;
}

/**
 * Parse a size string like "10MB" or ">5KB"
 */
function parseSize(value: string): { min?: number; max?: number } {
    const match = value.match(/^([<>])?(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i);
    if (!match || !match[2]) return {};

    const operator = match[1];
    const numStr = match[2];
    const unit = match[3] ?? 'b';
    const multiplier = SIZE_UNITS[unit.toLowerCase()] ?? 1;
    const bytes = parseFloat(numStr) * multiplier;

    if (operator === '>') {
        return { min: bytes };
    } else if (operator === '<') {
        return { max: bytes };
    }
    // Exact size (treat as approximate range)
    return { min: bytes * 0.9, max: bytes * 1.1 };
}

/**
 * Parse a date or date range string
 */
function parseDateValue(value: string): DateRange {
    // Check for relative dates
    const relative = RELATIVE_DATES[value.toLowerCase()];
    if (relative) {
        return { relative };
    }

    // Check for year range: 2022-2025
    const yearRangeMatch = value.match(/^(\d{4})-(\d{4})$/);
    if (yearRangeMatch && yearRangeMatch[1] && yearRangeMatch[2]) {
        const startYear = yearRangeMatch[1];
        const endYear = yearRangeMatch[2];
        return {
            start: new Date(`${startYear}-01-01`),
            end: new Date(`${endYear}-12-31T23:59:59.999Z`),
        };
    }

    // Check for month range: 2024-01..2024-06
    const monthRangeMatch = value.match(/^(\d{4}-\d{2})\.\.(\d{4}-\d{2})$/);
    if (monthRangeMatch && monthRangeMatch[1] && monthRangeMatch[2]) {
        const startMonth = monthRangeMatch[1];
        const endMonth = monthRangeMatch[2];
        const endDate = new Date(`${endMonth}-01`);
        endDate.setMonth(endDate.getMonth() + 1);
        endDate.setDate(0); // Last day of end month
        return {
            start: new Date(`${startMonth}-01`),
            end: endDate,
        };
    }

    // Check for single year: 2024
    const yearMatch = value.match(/^(\d{4})$/);
    if (yearMatch && yearMatch[1]) {
        const year = yearMatch[1];
        return {
            start: new Date(`${year}-01-01`),
            end: new Date(`${year}-12-31T23:59:59.999Z`),
        };
    }

    // Check for single date: 2024-07-15
    const dateMatch = value.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (dateMatch && dateMatch[1]) {
        const dateStr = dateMatch[1];
        return {
            start: new Date(dateStr),
            end: new Date(`${dateStr}T23:59:59.999Z`),
        };
    }

    // Invalid date format
    return {};
}

/**
 * Convert relative date to absolute date range
 */
export function resolveRelativeDate(relative: DateRange['relative']): { start: Date; end: Date } {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (relative) {
        case 'today':
            return {
                start: today,
                end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1),
            };
        case 'yesterday': {
            const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
            return {
                start: yesterday,
                end: new Date(yesterday.getTime() + 24 * 60 * 60 * 1000 - 1),
            };
        }
        case 'last-week':
            return {
                start: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000),
                end: now,
            };
        case 'last-month':
            return {
                start: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000),
                end: now,
            };
        case 'last-year':
            return {
                start: new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000),
                end: now,
            };
        default:
            return { start: today, end: now };
    }
}

/**
 * Parse the query string into a structured ParsedQuery object
 */
export function parseQuery(query: string): ParsedQuery {
    const tokens = tokenize(query.trim());
    const parsed: ParsedQuery = {};
    const negations: Partial<ParsedQuery> = {};
    const textParts: string[] = [];

    for (const token of tokens) {
        const target = token.negated ? negations : parsed;

        if (token.type === 'text' || token.type === 'quoted') {
            textParts.push(token.value);
            continue;
        }

        // Handle filters
        switch (token.key) {
            case 'in': {
                // Scoped text search: in:filename, in:content, in:summary
                const scope = token.value.toLowerCase();
                if (['filename', 'content', 'summary', 'all'].includes(scope)) {
                    parsed.searchScope = scope as ParsedQuery['searchScope'];
                }
                break;
            }

            case 'type': {
                // File type: type:photo, type:document
                const types = TYPE_ALIASES[token.value.toLowerCase()] || [token.value.toLowerCase()];
                if (!target.types) target.types = [];
                target.types.push(...types);
                break;
            }

            case 'format': {
                // File format: format:pdf, format:jpg
                if (!target.formats) target.formats = [];
                target.formats.push(token.value.toLowerCase());
                break;
            }

            case 'category': {
                // Document category: category:stock_statement
                if (!target.categories) target.categories = [];
                target.categories.push(token.value.toLowerCase());
                break;
            }

            case 'uploaded': {
                // Upload date filter: uploaded:2024, uploaded:last-week
                target.uploadedRange = parseDateValue(token.value);
                break;
            }

            case 'date': {
                // Extracted date filter: date:2023, date:2022-2025
                target.extractedDateRange = parseDateValue(token.value);
                break;
            }

            case 'folder': {
                // Folder filter: folder:/vacation/2024, folder:receipts
                if (!target.folders) target.folders = [];
                target.folders.push(token.value);
                break;
            }

            case 'has': {
                // Property filter: has:text, has:summary, has:thumbnail
                const prop = token.value.toLowerCase();
                if (prop === 'text') {
                    target.hasText = !token.negated;
                } else if (prop === 'summary') {
                    target.hasSummary = !token.negated;
                } else if (prop === 'thumbnail') {
                    target.hasThumbnail = !token.negated;
                }
                break;
            }

            case 'size': {
                // Size filter: size:>10MB, size:<100KB
                const sizeRange = parseSize(token.value);
                if (sizeRange.min) target.sizeMin = sizeRange.min;
                if (sizeRange.max) target.sizeMax = sizeRange.max;
                break;
            }

            case 'tag': {
                // Tag filter: tag:important, tag:tax
                if (!target.tags) target.tags = [];
                target.tags.push(token.value.toLowerCase());
                break;
            }

            case 'entity':
            case 'company': {
                // Entity filter: entity:Apple, company:"John Smith"
                if (!target.entities) target.entities = [];
                target.entities.push(token.value);
                break;
            }

            default:
                // Unknown filter, treat as text
                textParts.push(`${token.key}:${token.value}`);
        }
    }

    // Combine text parts
    if (textParts.length > 0) {
        parsed.fullText = textParts.join(' ');
    }

    // Add negations if any
    if (Object.keys(negations).length > 0) {
        parsed.negations = negations;
    }

    return parsed;
}

/**
 * Validate the parsed query and return any errors
 */
export function validateQuery(parsed: ParsedQuery): string[] {
    const errors: string[] = [];

    // Check for invalid date ranges
    if (parsed.uploadedRange) {
        if (parsed.uploadedRange.start && parsed.uploadedRange.end) {
            if (parsed.uploadedRange.start > parsed.uploadedRange.end) {
                errors.push('Upload date start cannot be after end date');
            }
        }
    }

    if (parsed.extractedDateRange) {
        if (parsed.extractedDateRange.start && parsed.extractedDateRange.end) {
            if (parsed.extractedDateRange.start > parsed.extractedDateRange.end) {
                errors.push('Document date start cannot be after end date');
            }
        }
    }

    // Check for negative size
    if (parsed.sizeMin && parsed.sizeMin < 0) {
        errors.push('Size cannot be negative');
    }
    if (parsed.sizeMax && parsed.sizeMax < 0) {
        errors.push('Size cannot be negative');
    }

    return errors;
}

/**
 * Convert parsed query back to query string (for display)
 */
export function stringifyQuery(parsed: ParsedQuery): string {
    const parts: string[] = [];

    if (parsed.fullText) {
        parts.push(parsed.fullText);
    }

    if (parsed.searchScope && parsed.searchScope !== 'all') {
        parts.push(`in:${parsed.searchScope}`);
    }

    if (parsed.types?.length) {
        parts.push(...parsed.types.map((t) => `type:${t}`));
    }

    if (parsed.formats?.length) {
        parts.push(...parsed.formats.map((f) => `format:${f}`));
    }

    if (parsed.categories?.length) {
        parts.push(...parsed.categories.map((c) => `category:${c}`));
    }

    if (parsed.folders?.length) {
        parts.push(...parsed.folders.map((f) => `folder:${f}`));
    }

    if (parsed.tags?.length) {
        parts.push(...parsed.tags.map((t) => `tag:${t}`));
    }

    if (parsed.entities?.length) {
        parts.push(...parsed.entities.map((e) => `entity:${e.includes(' ') ? `"${e}"` : e}`));
    }

    if (parsed.hasText !== undefined) {
        parts.push(parsed.hasText ? 'has:text' : '-has:text');
    }

    if (parsed.hasSummary !== undefined) {
        parts.push(parsed.hasSummary ? 'has:summary' : '-has:summary');
    }

    if (parsed.hasThumbnail !== undefined) {
        parts.push(parsed.hasThumbnail ? 'has:thumbnail' : '-has:thumbnail');
    }

    return parts.join(' ');
}
