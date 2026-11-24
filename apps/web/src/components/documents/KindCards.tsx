import { getFileTypeConfig } from '@/components/ui/FileTypeIcon';
import { dashboardCards, typeBlockCells, typeBlockColumns, type KindCard } from '@/lib/browse/dashboard-cards';
import { kindTitle } from '@/lib/browse/browse-kinds';
import { formatFileSize } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import type { Document, DocumentSummaryResponse } from '@reverie/shared';
import { Link } from '@tanstack/react-router';
import { Play } from 'lucide-react';
import { DocumentThumbnail } from './DocumentCard/DocumentThumbnail';

const CARD_HEIGHT = 'h-42';

interface KindCardsProps {
    /** The scope's totals; undefined while they load (the row is held with blank cards so the table below does not jump). */
    summary: DocumentSummaryResponse | undefined;
    /** The latest photos (up to six) and the latest video, for the pictures on their cards. */
    photos: Document[];
    video: Document | undefined;
}

/** The dashboard's picture cards: Photos, Videos and Files, each opening its own view. */
export function KindCards({ summary, photos, video }: KindCardsProps) {
    return (
        // A container query, not a viewport one: what matters is the page's width beside the sidebar.
        <div className="@container mt-5.5">
            <div className="flex flex-wrap gap-3">
                {summary ? (
                    dashboardCards(summary).map((card) => <KindCardView key={card.kind} card={card} photos={photos} video={video} />)
                ) : (
                    <CardPlaceholders />
                )}
            </div>
        </div>
    );
}

function CardPlaceholders() {
    return (
        <>
            <div className={cn(CARD_HEIGHT, 'basis-full animate-pulse rounded-[20px] bg-card @min-[900px]:flex-[2]')} aria-hidden />
            <div className={cn(CARD_HEIGHT, 'min-w-0 flex-1 animate-pulse rounded-[20px] bg-card')} aria-hidden />
            <div className={cn(CARD_HEIGHT, 'min-w-0 flex-1 animate-pulse rounded-[20px] bg-card')} aria-hidden />
        </>
    );
}

/** Photos is the wide card (twice the others from 900px of page width, a row of its own below); the rest share what is left. */
const CARD_WIDTH: Record<KindCard['kind'], string> = {
    image: 'basis-full @min-[900px]:flex-[2]',
    video: 'min-w-0 flex-1',
    file: 'min-w-0 flex-1',
};

function KindCardView({ card, photos, video }: { card: KindCard; photos: Document[]; video: Document | undefined }) {
    const title = kindTitle(card.kind);

    return (
        <Link
            to="."
            search={{ kind: card.kind }}
            state={{ fromBrowseDashboard: true }}
            preload={false}
            aria-label={`${title}, ${card.count} ${card.count === 1 ? 'item' : 'items'}`}
            className={cn(
                CARD_HEIGHT,
                CARD_WIDTH[card.kind],
                'group relative block overflow-hidden rounded-[20px] bg-card outline-none focus-visible:ring-2 focus-visible:ring-primary',
            )}
        >
            {card.kind === 'image' && <PhotoStrip photos={photos} />}
            {card.kind === 'video' && <VideoPicture video={video} />}
            {card.kind === 'file' && <TypeBlocks types={card.topTypes} />}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_40%,rgb(0_0_0/0.78))]" aria-hidden />
            <div className="absolute bottom-3 left-4 text-white">
                <div className="text-xl font-semibold leading-6">{title}</div>
                <div className="text-[13px] text-white/75">
                    {card.count} · {formatFileSize(card.bytes)}
                </div>
            </div>
        </Link>
    );
}

function PhotoStrip({ photos }: { photos: Document[] }) {
    return (
        <div className="absolute inset-0 flex gap-0.5">
            {photos.slice(0, 6).map((photo) => (
                <div key={photo.id} className="min-w-0 flex-1">
                    <DocumentThumbnail document={photo} variant="tile" size="md" showDuration={false} />
                </div>
            ))}
        </div>
    );
}

function VideoPicture({ video }: { video: Document | undefined }) {
    return (
        <>
            {video && (
                <div className="absolute inset-0">
                    <DocumentThumbnail document={video} variant="tile" size="lg" showDuration={false} />
                </div>
            )}
            <div className="absolute right-3 top-3 flex size-[34px] items-center justify-center rounded-full bg-black/45 text-white" aria-hidden>
                <Play className="size-4 fill-white" />
            </div>
        </>
    );
}

/** The Files card's blocks: its most common file types, each on the tint of that type's badge with the extension near the top. */
function TypeBlocks({ types }: { types: KindCard['topTypes'] }) {
    const cells = typeBlockCells(types);
    const columns = typeBlockColumns(types);

    return (
        <div className="absolute inset-0 grid gap-0.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {cells.map((type, index) => (
                <TypeBlock key={type?.ext ?? `empty-${index}`} ext={type?.ext ?? null} />
            ))}
        </div>
    );
}

function TypeBlock({ ext }: { ext: string | null }) {
    if (!ext) return <div className="bg-muted/40" />;

    const config = getFileTypeConfig('', `x.${ext}`);

    return (
        <div className={cn('flex items-start justify-center pt-3 font-mono text-xs font-semibold uppercase', config.bgColor, config.color)}>
            {ext.slice(0, 5)}
        </div>
    );
}
