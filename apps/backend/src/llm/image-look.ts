/**
 * Which images get the one Claude call that sees the picture together with its OCR text.
 *
 * Only screenshots, documents, receipts and diagrams do. A photo never does, and neither does an image nobody has
 * classified: when unsure the answer is no. The decision is made again when the job runs, so a job queued earlier
 * (or queued directly) cannot get an image through that is not allowed now.
 */
import type { Document } from '../db/schema';
import type { ImageKind } from '../image-kind/kinds';
import { isHeldBackFromVision, loadKindVerdict, type KindGate } from './photo-gate';

/** The kinds Claude may look at. A subset of the classifier's kinds: no photo, and no 'other'. */
export const LOOK_KINDS = ['screenshot', 'document', 'receipt', 'diagram'] as const;
export type LookKind = (typeof LOOK_KINDS)[number];

/** `heldBack` tells a photo (or an image with no verdict) from an image the classifier judged to be none of the four kinds. */
export type ImageLook = { call: true; kind: LookKind } | { call: false; heldBack: boolean };

function isLookKind(kind: string): kind is LookKind {
    return (LOOK_KINDS as readonly string[]).includes(kind);
}

/** The kind to look as, from a stored verdict: `photo` and `other` are not looked at. */
export function toLookKindFromVerdict(kind: ImageKind): LookKind | null {
    return isLookKind(kind) ? kind : null;
}

/**
 * Whether this image gets the call, and as which kind. Not looked at: a non-image, a photo (camera evidence, the
 * 'photo' category, a photo verdict), an image with no verdict (not classified yet, or reverie-ml is down: the OCR
 * heuristics call a phone photo a screenshot, so a category alone is never enough), and a verdict of `other`. A held
 * back image can be looked at later, once a verdict exists. Privacy and the trash are checked by the caller before this.
 */
export async function decideImageLook(document: Document, kindGate?: KindGate): Promise<ImageLook> {
    if (!document.mime_type.startsWith('image/')) return { call: false, heldBack: false };

    if (await isHeldBackFromVision(document, kindGate)) return { call: false, heldBack: true };

    const verdict = await loadKindVerdict(document.id);

    if (verdict === undefined) return { call: false, heldBack: true };

    const kind = toLookKindFromVerdict(verdict);

    return kind === null ? { call: false, heldBack: false } : { call: true, kind };
}
