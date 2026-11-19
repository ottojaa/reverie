# Summary model comparison

Runs the production summary pipeline (`analyzeOcrText`: prepare, prompt, model, entity grounding, spelling correction) over a private folder of documents for several models, and reports how well each spells the documents' proper nouns and what each costs.

**The repo is public. The documents live in `/comparison-docs/` at the repo root, which is gitignored. Never commit them or the generated `report.md`.**

## Documents

One file per document, `comparison-docs/<name>.json`:

```json
{
    "filename": "Invoice.pdf",
    "text": "OCR text of the document ...",
    "properNouns": ["Northwind Traders Ltd", "Catherine Hargreaves"]
}
```

`properNouns` are spelled the way the document prints them (including any OCR damage), because that is the spelling the pipeline is meant to preserve. Mix Finnish and English, and include names with diacritics and double letters (Jyväskylä, Äänekoski). Real documents can be pasted in as OCR text, from the dev database for instance, as long as the folder stays untracked.

## Run

From the repo root, with `ANTHROPIC_API_KEY` exported or in `.env`:

```sh
npx tsx apps/backend/src/scripts/compare-summary-models/index.ts
```

Options: `--dir` (default `comparison-docs`), `--variants` (default `claude-haiku-4-5,claude-haiku-5-5:low,claude-haiku-5-5:medium`, the first one is the baseline; a variant is `model` or `model:effort`), `--max-cost` (default 1.5 USD, stops the run). Twenty documents on three variants cost a few tens of cents.

## Report

`comparison-docs/report.md` and stdout. Each expected noun scores `exact` (appears verbatim in the title, summary, topics, tags or entities; inflections count), `near` (within one or two edits, or only the diacritics differ) or `absent`. The table gives counts per variant, total cost and cost per document (from the same `estimateCostUsd` as the per-summary log), average tokens, and stop reasons (a `max_tokens` stop means the thinking headroom is too small). "No worse" means at least as many exact nouns and no more absent ones than the baseline. The report also lists the nouns that were not exact and the entity names that differ between variants.
