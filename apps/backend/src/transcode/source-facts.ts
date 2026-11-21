import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import type { VideoProbe } from '../media/video-probe';
import type { SourceFacts } from './ladder';

/** A video the ladder cannot be decided for: no readable picture size. Final: another try reads the same file. */
export class UnusableSourceError extends Error {}

/** The facts as both sources give them: the stored row and a fresh probe name them differently, and either may lack a size. */
interface RawFacts {
    width: number | null;
    height: number | null;
    rotation: number | null;
    frameRate: number | null;
    isHdr: boolean;
    colorTransfer: string | null;
    audioCodec: string | null;
}

function toSourceFacts({ width, height, rotation, frameRate, isHdr, colorTransfer, audioCodec }: RawFacts): SourceFacts {
    if (!width || !height) throw new UnusableSourceError('Video has no picture size');

    return { width, height, rotation: rotation ?? 0, frameRate, isHdr, colorTransfer, hasAudio: audioCodec !== null };
}

/**
 * The facts the ladder is decided from: the stored ffprobe facts (written by the thumbnail step), or, for a video that
 * has none yet, a probe of the file. A stored row exists only after a probe, so a null audio codec means no audio.
 */
export async function loadSourceFacts(db: Kysely<Database>, documentId: string, probe: () => Promise<VideoProbe>): Promise<SourceFacts> {
    const row = await db.selectFrom('video_metadata').selectAll().where('document_id', '=', documentId).executeTakeFirst();

    if (row?.width && row.height) {
        return toSourceFacts({
            width: row.width,
            height: row.height,
            rotation: row.rotation,
            frameRate: row.frame_rate,
            isHdr: row.is_hdr,
            colorTransfer: row.color_transfer,
            audioCodec: row.audio_codec,
        });
    }

    const { video } = await probe();

    return toSourceFacts(video);
}
