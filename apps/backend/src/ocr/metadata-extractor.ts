import type { CurrencyValue, ExtractedMetadata } from './types';
import { DATE_PATTERNS, MONTH_MAP, CURRENCY_PATTERNS, PERCENTAGE_PATTERNS, COMPANY_PATTERNS, STOCK_TICKERS, parseNumber } from './patterns';

/**
 * Metadata Extractor (Plan 05)
 *
 * Parses structured data from OCR text:
 * - Dates
 * - Companies
 * - Currency values
 * - Percentages
 */

/**
 * Extract all structured metadata from text
 */
export function extractMetadata(text: string): ExtractedMetadata {
    const dates = extractDates(text);
    const companies = extractCompanies(text);
    const currencyValues = extractCurrencyValues(text);
    const percentages = extractPercentages(text);

    // Determine primary date (best guess for document date)
    const primaryDate = determinePrimaryDate(dates, text);

    const result: ExtractedMetadata = {
        dates,
        companies,
        currencyValues,
        percentages,
    };

    if (primaryDate) {
        result.primaryDate = primaryDate;
    }

    return result;
}

/**
 * Extract dates from text
 */
export function extractDates(text: string): Date[] {
    const dates: Date[] = [];
    const seenDates = new Set<string>(); // Avoid duplicates

    // Helper to add date if valid and not duplicate
    const addDate = (date: Date) => {
        const key = date.toISOString().split('T')[0] ?? '';
        if (key && !seenDates.has(key) && isValidDate(date)) {
            seenDates.add(key);
            dates.push(date);
        }
    };

    // Helper to safely parse match groups
    const safeParseInt = (val: string | undefined): number => parseInt(val ?? '0', 10);

    // ISO format: YYYY-MM-DD
    for (const match of text.matchAll(DATE_PATTERNS.iso)) {
        const year = match[1];
        const month = match[2];
        const day = match[3];
        if (year && month && day) {
            addDate(new Date(safeParseInt(year), safeParseInt(month) - 1, safeParseInt(day)));
        }
    }

    // US format: MM/DD/YYYY
    for (const match of text.matchAll(DATE_PATTERNS.usSlash)) {
        const month = match[1];
        const day = match[2];
        const year = match[3];
        if (month && day && year) {
            addDate(new Date(safeParseInt(year), safeParseInt(month) - 1, safeParseInt(day)));
        }
    }

    // European dot format: DD.MM.YYYY
    for (const match of text.matchAll(DATE_PATTERNS.euDot)) {
        const day = match[1];
        const month = match[2];
        const year = match[3];
        if (day && month && year) {
            addDate(new Date(safeParseInt(year), safeParseInt(month) - 1, safeParseInt(day)));
        }
    }

    // Month name formats
    for (const match of text.matchAll(DATE_PATTERNS.monthNameFull)) {
        const monthName = match[1];
        const day = match[2];
        const year = match[3];
        if (monthName && day && year) {
            const month = MONTH_MAP[monthName.toLowerCase()];
            if (month) {
                addDate(new Date(safeParseInt(year), month - 1, safeParseInt(day)));
            }
        }
    }

    for (const match of text.matchAll(DATE_PATTERNS.monthNameShort)) {
        const monthName = match[1];
        const day = match[2];
        const year = match[3];
        if (monthName && day && year) {
            const month = MONTH_MAP[monthName.toLowerCase()];
            if (month) {
                addDate(new Date(safeParseInt(year), month - 1, safeParseInt(day)));
            }
        }
    }

    for (const match of text.matchAll(DATE_PATTERNS.dayMonthYear)) {
        const day = match[1];
        const monthName = match[2];
        const year = match[3];
        if (day && monthName && year) {
            const month = MONTH_MAP[monthName.toLowerCase()];
            if (month) {
                addDate(new Date(safeParseInt(year), month - 1, safeParseInt(day)));
            }
        }
    }

    // Sort dates chronologically
    dates.sort((a, b) => a.getTime() - b.getTime());

    return dates;
}

/**
 * Determine the most likely "document date"
 *
 * Priority:
 * 1. Dates near top of document
 * 2. Most recent date (likely document date, not historical reference)
 */
function determinePrimaryDate(dates: Date[], text: string): Date | undefined {
    if (dates.length === 0) return undefined;
    if (dates.length === 1) return dates[0];

    // Get first 500 characters (top of document)
    const topText = text.slice(0, 500);
    const topDates = extractDates(topText);

    // If there's a date in the top portion, prefer the most recent one there
    if (topDates.length > 0) {
        return topDates[topDates.length - 1];
    }

    // Otherwise, return the most recent date overall
    return dates[dates.length - 1];
}

/**
 * Validate that a date is reasonable (not too far in past/future)
 */
function isValidDate(date: Date): boolean {
    const now = new Date();
    const minYear = 1900;
    const maxYear = now.getFullYear() + 10;

    return date.getFullYear() >= minYear && date.getFullYear() <= maxYear && !isNaN(date.getTime());
}

/**
 * Extract company names from text
 */
export function extractCompanies(text: string): string[] {
    const companyCounts = new Map<string, number>();

    // Helper to add/count company
    const addCompany = (name: string) => {
        const normalized = name.trim();
        if (normalized.length > 2) {
            companyCounts.set(normalized, (companyCounts.get(normalized) || 0) + 1);
        }
    };

    // Match company patterns
    for (const match of text.matchAll(COMPANY_PATTERNS.inc)) {
        if (match[1]) {
            addCompany(match[1] + ' Inc.');
        }
    }

    for (const match of text.matchAll(COMPANY_PATTERNS.corp)) {
        if (match[1]) {
            addCompany(match[1] + ' Corporation');
        }
    }

    for (const match of text.matchAll(COMPANY_PATTERNS.llc)) {
        if (match[1]) {
            addCompany(match[1] + ' LLC');
        }
    }

    for (const match of text.matchAll(COMPANY_PATTERNS.ltd)) {
        if (match[1]) {
            addCompany(match[1] + ' Ltd.');
        }
    }

    // Match stock tickers
    for (const match of text.matchAll(COMPANY_PATTERNS.ticker)) {
        const ticker = match[1];
        if (ticker && STOCK_TICKERS.has(ticker)) {
            addCompany(ticker);
        }
    }

    // Sort by frequency (most mentioned first)
    const sorted = Array.from(companyCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name);

    return sorted;
}

/**
 * Extract currency values from text
 */
export function extractCurrencyValues(text: string): CurrencyValue[] {
    const values: CurrencyValue[] = [];

    // Helper to safely extract match
    const extractValue = (match: RegExpMatchArray, currency: string) => {
        const val = match[1];
        if (val) {
            values.push({ amount: parseNumber(val), currency });
        }
    };

    // USD patterns
    for (const match of text.matchAll(CURRENCY_PATTERNS.usDollar)) {
        extractValue(match, 'USD');
    }

    for (const match of text.matchAll(CURRENCY_PATTERNS.usdPrefix)) {
        extractValue(match, 'USD');
    }

    // EUR patterns
    for (const match of text.matchAll(CURRENCY_PATTERNS.euro)) {
        extractValue(match, 'EUR');
    }

    for (const match of text.matchAll(CURRENCY_PATTERNS.eurPrefix)) {
        extractValue(match, 'EUR');
    }

    // GBP patterns
    for (const match of text.matchAll(CURRENCY_PATTERNS.gbp)) {
        extractValue(match, 'GBP');
    }

    for (const match of text.matchAll(CURRENCY_PATTERNS.gbpPrefix)) {
        extractValue(match, 'GBP');
    }

    // JPY/CNY patterns
    for (const match of text.matchAll(CURRENCY_PATTERNS.yen)) {
        extractValue(match, 'JPY');
    }

    // Filter out zero values and sort by amount
    return values.filter((v) => v.amount > 0).sort((a, b) => b.amount - a.amount);
}

/**
 * Extract percentages from text
 */
export function extractPercentages(text: string): number[] {
    const percentages: number[] = [];

    for (const match of text.matchAll(PERCENTAGE_PATTERNS.standard)) {
        const val = match[1];
        if (val) {
            const value = parseNumber(val);
            if (value >= 0 && value <= 10000) {
                // Reasonable percentage range
                percentages.push(value);
            }
        }
    }

    for (const match of text.matchAll(PERCENTAGE_PATTERNS.labeled)) {
        const val = match[1];
        if (val) {
            const value = parseNumber(val);
            if (value >= 0 && value <= 10000) {
                percentages.push(value);
            }
        }
    }

    // Remove duplicates
    return [...new Set(percentages)];
}
