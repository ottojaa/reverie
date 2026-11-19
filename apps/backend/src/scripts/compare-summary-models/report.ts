/**
 * Report building for the model-comparison harness (pure: results in, markdown out).
 */

import { countOutcomes, isNoWorse, type NounOutcome, type OutcomeCounts } from './scoring';

export interface DocRun {
    doc: string;
    /** Set when the summary call failed; every noun then scores absent. */
    error?: string;
    outcomes: Array<{ noun: string; outcome: NounOutcome }>;
    entityNames: string[];
    costUsd: number | null;
    inputTokens: number;
    outputTokens: number;
    stopReason: string | null;
}

export interface VariantRun {
    label: string;
    runs: DocRun[];
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

function variantCounts(variant: VariantRun): OutcomeCounts {
    return countOutcomes(variant.runs.flatMap((run) => run.outcomes.map((entry) => entry.outcome)));
}

function formatUsd(value: number): string {
    return '$' + value.toFixed(5);
}

function summaryRow(variant: VariantRun): string {
    const counts = variantCounts(variant);
    const costs = variant.runs.map((run) => run.costUsd ?? 0);
    const stops = new Map<string, number>();

    for (const run of variant.runs) {
        const key = run.error ? 'error' : (run.stopReason ?? 'unknown');

        stops.set(key, (stops.get(key) ?? 0) + 1);
    }

    const perDoc = variant.runs.length > 0 ? sum(costs) / variant.runs.length : 0;
    const stopText = [...stops].map(([key, count]) => key + ' ' + count).join(', ');

    return `| ${variant.label} | ${counts.exact} | ${counts.near} | ${counts.absent} | ${formatUsd(sum(costs))} | ${formatUsd(perDoc)} | ${Math.round(sum(variant.runs.map((run) => run.inputTokens)) / Math.max(variant.runs.length, 1))} / ${Math.round(sum(variant.runs.map((run) => run.outputTokens)) / Math.max(variant.runs.length, 1))} | ${stopText} |`;
}

function nounDiffLines(variants: VariantRun[]): string[] {
    const lines: string[] = [];
    const docs = variants[0]?.runs.map((run) => run.doc) ?? [];

    for (const doc of docs) {
        const misses = variants.map((variant) => {
            const run = variant.runs.find((candidate) => candidate.doc === doc);
            const missed = (run?.outcomes ?? []).filter((entry) => entry.outcome !== 'exact').map((entry) => `${entry.noun} (${entry.outcome})`);

            return { label: variant.label, missed, error: run?.error };
        });

        if (misses.every((entry) => entry.missed.length === 0 && !entry.error)) continue;

        lines.push(`- **${doc}**`);

        for (const entry of misses) {
            lines.push(`    - ${entry.label}: ${entry.error ? 'ERROR ' + entry.error : entry.missed.join('; ') || 'all exact'}`);
        }
    }

    return lines;
}

/** Entity names the other variants produced that the first (baseline) variant did not, and vice versa. */
function entityDiffLines(variants: VariantRun[]): string[] {
    const [baseline, ...others] = variants;
    const lines: string[] = [];

    if (!baseline) return lines;

    for (const other of others) {
        for (const baseRun of baseline.runs) {
            const otherRun = other.runs.find((candidate) => candidate.doc === baseRun.doc);
            const baseNames = new Set(baseRun.entityNames);
            const otherNames = new Set(otherRun?.entityNames ?? []);
            const onlyOther = [...otherNames].filter((name) => !baseNames.has(name));
            const onlyBase = [...baseNames].filter((name) => !otherNames.has(name));

            if (onlyOther.length === 0 && onlyBase.length === 0) continue;

            lines.push(
                `- ${baseRun.doc} (${other.label} vs ${baseline.label}): only ${other.label}: ${onlyOther.join(', ') || '-'}; only ${baseline.label}: ${onlyBase.join(', ') || '-'}`,
            );
        }
    }

    return lines;
}

/** The first variant is the baseline the others are judged against. */
export function buildReport(variants: VariantRun[], docCount: number, nounCount: number): string {
    const [baseline, ...others] = variants;
    const lines = [
        '# Summary model comparison',
        '',
        `${docCount} documents, ${nounCount} expected proper nouns. Baseline: ${baseline?.label ?? '-'}.`,
        '"No worse" means at least as many exact nouns and no more absent nouns than the baseline.',
        '',
        '| Variant | Exact | Near | Absent | Total cost | Cost / doc | Avg tokens in / out | Stop reasons |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        ...variants.map(summaryRow),
        '',
    ];

    if (baseline) {
        for (const other of others) {
            lines.push(
                `- ${other.label} proper-noun spelling no worse than ${baseline.label}: **${isNoWorse(variantCounts(other), variantCounts(baseline)) ? 'YES' : 'NO'}**`,
            );
        }
    }

    lines.push('', '## Proper nouns that were not exact', '', ...nounDiffLines(variants), '', '## Entity differences', '', ...entityDiffLines(variants), '');

    return lines.join('\n');
}
