// Domain types for documents (not tied to API schemas)

export interface OcrResult {
  raw_text: string
  confidence_score: number
  metadata: ExtractedMetadata
}

export interface ExtractedMetadata {
  dates: string[]
  primary_date?: string
  companies: string[]
  currency_values: CurrencyValue[]
  stock_quantities: number[]
  percentages: number[]
}

export interface CurrencyValue {
  amount: number
  currency: string
}

export interface LlmMetadata {
  title?: string
  key_entities: string[]
  topics: string[]
  sentiment?: 'positive' | 'neutral' | 'negative'
  document_type?: string
  extracted_dates?: string[]
  key_values?: KeyValue[]
}

export interface KeyValue {
  label: string
  value: string
}

