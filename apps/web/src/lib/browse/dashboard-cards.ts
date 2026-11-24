import type { DocumentKind, DocumentSummaryResponse } from '@reverie/shared';

type TopType = DocumentSummaryResponse['file']['top_types'][number];

/** A picture card of the dashboard: one kind and what the summary says about it. */
export interface KindCard {
    kind: DocumentKind;
    count: number;
    bytes: number;
    /** The file types shown as blocks on the Files card; empty on the other cards. */
    topTypes: TopType[];
}

const KIND_ORDER: DocumentKind[] = ['image', 'video', 'file'];

/** The cards to draw, in the order Photos, Videos, Files. A kind with nothing in scope has no card. */
export function dashboardCards(summary: DocumentSummaryResponse): KindCard[] {
    return KIND_ORDER.flatMap((kind): KindCard[] => {
        const totals = summary[kind];

        if (totals.count === 0) return [];

        return [{ kind, count: totals.count, bytes: totals.bytes, topTypes: kind === 'file' ? summary.file.top_types : [] }];
    });
}

/** The Files card's type blocks: one fills the card, two sit side by side, three or four make a 2×2 (a missing fourth is a neutral block). */
export function typeBlockCells(types: TopType[]): Array<TopType | null> {
    const shown = types.slice(0, 4);

    if (shown.length === 0) return [null];

    if (shown.length === 3) return [...shown, null];

    return shown;
}

/** How many columns the type blocks of a Files card are laid out in: one block fills the card, otherwise two columns. */
export function typeBlockColumns(types: TopType[]): number {
    return types.length <= 1 ? 1 : 2;
}
