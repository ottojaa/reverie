#!/usr/bin/env node
/**
 * Compare per-document summaries across models on a private folder of documents.
 *
 * Runs the production text pipeline (analyzeOcrText) on every document for each
 * variant and writes report.md next to the documents. See README.md.
 *
 *   npx tsx apps/backend/src/scripts/compare-summary-models/index.ts
 *   npx tsx apps/backend/src/scripts/compare-summary-models/index.ts --variants claude-haiku-4-5,claude-haiku-5-5:low
 */
import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { buildReport, type DocRun, type VariantRun } from './report';
import { scoreProperNoun } from './scoring';

interface ComparisonDoc {
    name: string;
    filename: string;
    text: string;
    properNouns: string[];
}

interface Variant {
    label: string;
    model: string;
    effort?: 'low' | 'medium' | 'high';
}

function parseVariant(label: string): Variant {
    const [model = '', effort] = label.split(':');

    if (effort !== undefined && effort !== 'low' && effort !== 'medium' && effort !== 'high') {
        throw new Error('Unknown effort in variant: ' + label);
    }

    return effort ? { label, model, effort } : { label, model };
}

async function loadDocs(dir: string): Promise<ComparisonDoc[]> {
    const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
    const docs: ComparisonDoc[] = [];

    for (const name of names) {
        const parsed = JSON.parse(await readFile(join(dir, name), 'utf-8')) as Omit<ComparisonDoc, 'name'>;

        docs.push({ name: name.replace(/\.json$/, ''), ...parsed });
    }

    return docs;
}

async function main(): Promise<void> {
    const argv = await yargs(hideBin(process.argv))
        .option('dir', { type: 'string', default: 'comparison-docs', describe: 'Folder of <name>.json documents (gitignored)' })
        .option('variants', {
            type: 'string',
            default: 'claude-haiku-4-5,claude-haiku-5-5:low,claude-haiku-5-5:medium',
            describe: 'Comma-separated model[:effort]; the first is the baseline',
        })
        .option('max-cost', { type: 'number', default: 1.5, describe: 'Stop when the running API cost (USD) passes this' })
        .strict()
        .parseAsync();

    // env.ts requires DATABASE_URL at import; this script never touches the database.
    process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

    // Import after the env is set so env.ts (which validates + can exit) loads lazily.
    const { env } = await import('../../config/env.js');
    const { analyzeOcrText } = await import('../../llm/text-analysis.js');

    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set: export it or put it in .env');

    const docs = await loadDocs(argv.dir);
    const variants = argv.variants.split(',').map((label) => parseVariant(label.trim()));
    let spent = 0;
    const results: VariantRun[] = [];

    for (const variant of variants) {
        const runs: DocRun[] = [];

        for (const doc of docs) {
            if (spent > argv['max-cost']) throw new Error('Stopped: running cost passed --max-cost: ' + spent.toFixed(4));

            try {
                const analysis = await analyzeOcrText({ original_filename: doc.filename }, { raw_text: doc.text, confidence_score: null }, variant);
                const entityNames = analysis.entities.map((entity) => entity.canonical_name);
                const texts = [analysis.title ?? '', analysis.summary, ...analysis.topics, ...analysis.tags, ...entityNames];

                spent += analysis.call.costUsd ?? 0;
                runs.push({
                    doc: doc.name,
                    outcomes: doc.properNouns.map((noun) => ({ noun, outcome: scoreProperNoun(noun, texts) })),
                    entityNames,
                    costUsd: analysis.call.costUsd,
                    inputTokens: analysis.call.usage.input_tokens,
                    outputTokens: analysis.call.usage.output_tokens,
                    stopReason: analysis.call.stopReason,
                });
            } catch (error) {
                runs.push({
                    doc: doc.name,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    outcomes: doc.properNouns.map((noun) => ({ noun, outcome: 'absent' as const })),
                    entityNames: [],
                    costUsd: null,
                    inputTokens: 0,
                    outputTokens: 0,
                    stopReason: null,
                });
            }
        }

        results.push({ label: variant.label, runs });
    }

    const report = buildReport(
        results,
        docs.length,
        docs.reduce((total, doc) => total + doc.properNouns.length, 0),
    );

    await writeFile(join(argv.dir, 'report.md'), report);
    console.log(report);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
