import type { BrowseLayout } from '@/lib/browse/browse-layout';
import type { CardsRow } from '@/lib/browse/document-months';
import type { CSSProperties } from 'react';
import { DocumentCard } from './DocumentCard';
import { DocumentTile } from './DocumentTile';

interface DocumentGridRowProps {
    row: CardsRow;
    layout: BrowseLayout;
    /** Cells per row in Cards (the last row is padded to this); unused by the tile layouts. */
    columns: number;
    /** Side of a square tile in the Grid layout. */
    tileSide: number;
    orderedIds: string[];
    pulsingIds: Set<string>;
    onPulseComplete: (id: string) => void;
    style: CSSProperties;
}

/** One virtualized row of pictures: equal cards, square tiles, or tiles of fixed widths (Justified). */
export function DocumentGridRow({ row, layout, columns, tileSide, orderedIds, pulsingIds, onPulseComplete, style }: DocumentGridRowProps) {
    if (layout !== 'cards') {
        return (
            <div className="absolute left-0 right-0 flex" style={style}>
                {row.documents.map((doc, i) => (
                    <DocumentTile
                        key={doc.id}
                        document={doc}
                        orderedIds={orderedIds}
                        width={row.widths?.[i] ?? tileSide}
                        height={row.height ?? tileSide}
                        shouldPulse={pulsingIds.has(doc.id)}
                        onPulseComplete={() => onPulseComplete(doc.id)}
                    />
                ))}
            </div>
        );
    }

    return (
        <div className="absolute left-0 right-0 flex" style={style}>
            {row.documents.map((doc) => (
                <div key={doc.id} style={{ flex: `1 1 0%`, minWidth: 0 }}>
                    <DocumentCard document={doc} orderedIds={orderedIds} shouldPulse={pulsingIds.has(doc.id)} onPulseComplete={() => onPulseComplete(doc.id)} />
                </div>
            ))}
            {/* Fill empty slots in the last row to maintain consistent card widths */}
            {row.documents.length < columns &&
                Array.from({ length: columns - row.documents.length }).map((_, i) => <div key={`empty-${i}`} style={{ flex: `1 1 0%`, minWidth: 0 }} />)}
        </div>
    );
}
