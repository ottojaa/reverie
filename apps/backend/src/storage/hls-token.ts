/**
 * The signed path of a video's HLS renditions: `/files/hls/{exp}/{sig}/{fileHash}/{rest}`.
 *
 * A playlist's segment URLs are relative, so a signature over one exact URI (the file URLs' scheme) cannot cover
 * them. The token sits in the path instead: it authorises everything under one set (`transcode/{fileHash}/`) until
 * `exp`, and a player resolving `v720/seg_0001.m4s` against the master URL carries it along.
 *
 * nginx checks the same token with `secure_link_md5 "$exp/hls/$key$secret"` (config/nginx/api.reverieapp.dev.conf);
 * the dev route in files.route.ts checks it with `verifyHlsToken`. Both must agree with `signHlsToken`.
 */
import { createHash, timingSafeEqual } from 'crypto';
import { env } from '../config/env';

/** A content hash as stored in `documents.file_hash` (SHA-256, hex). */
const FILE_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** One or more path segments of letters, digits, `_`, `-` and `.`, each starting with a letter, digit, `_` or `-`: no `..`, no dotfiles. */
const REST_PATTERN = /^([A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

export type HlsTokenCheck = 'ok' | 'invalid' | 'expired';

function toSignature(expires: number, fileHash: string): string {
    return createHash('md5').update(`${expires}/hls/${fileHash}${env.FILE_URL_SECRET}`).digest('base64url');
}

export function isFileHash(value: string): boolean {
    return FILE_HASH_PATTERN.test(value);
}

/** Whether `rest` names a file inside a set: plain segments only, so it cannot climb out of `transcode/{fileHash}/`. */
export function isSetFilePath(rest: string): boolean {
    return REST_PATTERN.test(rest);
}

/** The signed URL of a set's file, relative to the API origin. */
export function toHlsUrl(fileHash: string, rest: string, expiresInSeconds: number): string {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;

    return `/files/hls/${expires}/${toSignature(expires, fileHash)}/${fileHash}/${rest}`;
}

export function verifyHlsToken(expiresParam: string, signature: string, fileHash: string): HlsTokenCheck {
    if (!/^\d+$/.test(expiresParam) || !isFileHash(fileHash)) return 'invalid';

    const expected = Buffer.from(toSignature(Number(expiresParam), fileHash));
    const given = Buffer.from(signature);

    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'invalid';

    return Math.floor(Date.now() / 1000) > Number(expiresParam) ? 'expired' : 'ok';
}
