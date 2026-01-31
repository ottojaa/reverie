/**
 * Regex patterns for metadata extraction from OCR text (Plan 05)
 */

/**
 * Date patterns for various formats
 */
export const DATE_PATTERNS = {
    // MM/DD/YYYY or M/D/YYYY
    usSlash: /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12][0-9]|3[01])\/(\d{4})\b/g,

    // DD/MM/YYYY or D/M/YYYY (European)
    euSlash: /\b(0?[1-9]|[12][0-9]|3[01])\/(0?[1-9]|1[0-2])\/(\d{4})\b/g,

    // DD.MM.YYYY (European with dots)
    euDot: /\b(0?[1-9]|[12][0-9]|3[01])\.(0?[1-9]|1[0-2])\.(\d{4})\b/g,

    // YYYY-MM-DD (ISO)
    iso: /\b(\d{4})-(0?[1-9]|1[0-2])-(0?[1-9]|[12][0-9]|3[01])\b/g,

    // Month DD, YYYY (e.g., "January 15, 2024")
    monthNameFull: /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/gi,

    // Mon DD, YYYY (e.g., "Jan 15, 2024")
    monthNameShort: /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[.,]?\s+(\d{1,2}),?\s+(\d{4})\b/gi,

    // DD Month YYYY (e.g., "15 January 2024")
    dayMonthYear: /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/gi,
};

/**
 * Month name to number mapping
 */
export const MONTH_MAP: Record<string, number> = {
    january: 1,
    jan: 1,
    february: 2,
    feb: 2,
    march: 3,
    mar: 3,
    april: 4,
    apr: 4,
    may: 5,
    june: 6,
    jun: 6,
    july: 7,
    jul: 7,
    august: 8,
    aug: 8,
    september: 9,
    sep: 9,
    october: 10,
    oct: 10,
    november: 11,
    nov: 11,
    december: 12,
    dec: 12,
};

/**
 * Currency patterns
 */
export const CURRENCY_PATTERNS = {
    // $1,234.56 or $ 1,234.56
    usDollar: /\$\s?([\d,]+\.?\d*)/g,

    // USD 1,234.56 or USD1234.56
    usdPrefix: /USD\s?([\d,]+\.?\d*)/gi,

    // €1.234,56 or € 1.234,56 (European format)
    euro: /€\s?([\d.]+,?\d*)/g,

    // EUR 1.234,56
    eurPrefix: /EUR\s?([\d.]+,?\d*)/gi,

    // £1,234.56
    gbp: /£\s?([\d,]+\.?\d*)/g,

    // GBP 1,234.56
    gbpPrefix: /GBP\s?([\d,]+\.?\d*)/gi,

    // ¥1,234 (Japanese Yen/Chinese Yuan)
    yen: /¥\s?([\d,]+)/g,
};

/**
 * Percentage patterns
 */
export const PERCENTAGE_PATTERNS = {
    // 12.5% or 12,5% or 12%
    standard: /([\d]+[.,]?\d*)\s?%/g,

    // percent: 12.5 or Percent: 12,5
    labeled: /percent[:\s]+([\d]+[.,]?\d*)/gi,
};

/**
 * Common stock tickers (US major stocks)
 */
export const STOCK_TICKERS = new Set([
    'AAPL',
    'MSFT',
    'GOOGL',
    'GOOG',
    'AMZN',
    'NVDA',
    'META',
    'TSLA',
    'BRK.A',
    'BRK.B',
    'UNH',
    'JNJ',
    'XOM',
    'JPM',
    'V',
    'PG',
    'MA',
    'HD',
    'CVX',
    'MRK',
    'ABBV',
    'LLY',
    'KO',
    'PEP',
    'AVGO',
    'COST',
    'TMO',
    'MCD',
    'WMT',
    'CSCO',
    'ACN',
    'ABT',
    'DHR',
    'BAC',
    'VZ',
    'ADBE',
    'CMCSA',
    'PFE',
    'DIS',
    'NFLX',
    'CRM',
    'NKE',
    'INTC',
    'AMD',
    'QCOM',
    'T',
    'TXN',
    'IBM',
    'ORCL',
    'PM',
]);

/**
 * Company name patterns
 */
export const COMPANY_PATTERNS = {
    // Company Name Inc. / Inc
    inc: /([A-Z][A-Za-z\s&.']+)\s+Inc\.?(?:\s|$|,)/g,

    // Company Name Corporation / Corp.
    corp: /([A-Z][A-Za-z\s&.']+)\s+Corp(?:oration)?\.?(?:\s|$|,)/g,

    // Company Name LLC / L.L.C.
    llc: /([A-Z][A-Za-z\s&.']+)\s+L\.?L\.?C\.?(?:\s|$|,)/g,

    // Company Name Ltd. / Limited
    ltd: /([A-Z][A-Za-z\s&.']+)\s+(?:Ltd|Limited)\.?(?:\s|$|,)/g,

    // Company Name Co. / Company
    co: /([A-Z][A-Za-z\s&.']+)\s+Co(?:mpany)?\.?(?:\s|$|,)/g,

    // Stock ticker pattern (all caps, 1-5 letters)
    ticker: /\b([A-Z]{1,5})\b/g,
};

/**
 * Category keyword patterns for document classification
 */
export const CATEGORY_KEYWORDS: Record<string, { keywords: string[]; weight: number }> = {
    receipt: {
        keywords: ['receipt', 'purchase', 'total', 'subtotal', 'thank you for your purchase', 'customer copy', 'transaction'],
        weight: 1,
    },
    invoice: {
        keywords: ['invoice', 'bill to', 'due date', 'amount due', 'invoice number', 'inv #', 'payment terms'],
        weight: 1,
    },
    statement: {
        keywords: ['statement', 'account', 'balance', 'period', 'account number', 'beginning balance', 'ending balance'],
        weight: 1,
    },
    letter: {
        keywords: ['dear', 'sincerely', 'regards', 'yours truly', 'to whom it may concern', 'best regards', 'kind regards'],
        weight: 1,
    },
    contract: {
        keywords: ['agreement', 'contract', 'parties', 'hereby', 'whereas', 'witnesseth', 'terms and conditions', 'binding'],
        weight: 1,
    },
    form: {
        keywords: ['form', 'please fill', 'signature', 'sign here', 'checkbox', 'application', 'applicant', 'date of birth'],
        weight: 1,
    },
    certificate: {
        keywords: ['certificate', 'certify', 'awarded', 'license', 'certified', 'this certifies', 'completion', 'achievement'],
        weight: 1,
    },
    report: {
        keywords: ['report', 'analysis', 'findings', 'conclusion', 'summary', 'executive summary', 'recommendations'],
        weight: 1,
    },
    memo: {
        keywords: ['memo', 'memorandum', 'to:', 'from:', 're:', 'subject:', 'internal memo', 'interoffice'],
        weight: 1,
    },
    newsletter: {
        keywords: ['newsletter', 'subscribe', 'issue', 'edition', 'volume', 'unsubscribe', 'weekly update', 'monthly update'],
        weight: 1,
    },
    stock_statement: {
        keywords: ['dividend', 'shares', 'stock', 'portfolio', 'holdings', 'securities', 'brokerage', 'investment'],
        weight: 1,
    },
    dividend_notice: {
        keywords: ['dividend', 'distribution', 'payout', 'reinvestment', 'record date', 'payment date', 'per share'],
        weight: 1.5, // Higher weight for specific match
    },
    tax_document: {
        keywords: ['tax', 'w-2', '1099', 'return', 'irs', 'taxable', 'deduction', 'withholding', 'form 1040'],
        weight: 1,
    },
};

/**
 * Parse a number from various formats
 */
export function parseNumber(str: string): number {
    // Remove currency symbols and whitespace
    let cleaned = str.replace(/[$€£¥\s]/g, '');

    // Detect European format (1.234,56) vs US format (1,234.56)
    // European: dots for thousands, comma for decimal
    // US: commas for thousands, dot for decimal
    const hasEuropeanFormat = /^\d{1,3}(\.\d{3})*(,\d+)?$/.test(cleaned);

    if (hasEuropeanFormat) {
        // Convert European to standard: 1.234,56 -> 1234.56
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
        // US format: just remove commas
        cleaned = cleaned.replace(/,/g, '');
    }

    return parseFloat(cleaned) || 0;
}
