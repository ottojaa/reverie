import { BlockList, isIP } from 'node:net';
import { z } from 'zod';

const ADDRESS_BITS: Record<number, number> = { 4: 32, 6: 128 };

/**
 * An IPv4 peer is also matched against IPv6 ranges, in its `::ffff:a.b.c.d` form, so a range that holds all of
 * those trusts every IPv4 address: `::ffff:172.18.0.1/32` does.
 */
function isEveryIpv4Address(address: string, prefix: number): boolean {
    if (isIP(address) !== 6 || prefix > 96) return false;

    const range = new BlockList();

    range.addSubnet(address, prefix, 'ipv6');

    return range.check('::ffff:0:0', 'ipv6');
}

/** One IP address, or a range as `address/prefix length`. */
function isAddressOrRange(entry: string): boolean {
    const [address = '', prefix, ...rest] = entry.split('/');
    const bits = ADDRESS_BITS[isIP(address)];

    if (!bits || rest.length > 0 || address.includes('%')) return false;

    if (prefix === undefined) return true;

    // Not just Number(): it also reads "", " 8" and "0x8".
    const length = /^\d+$/.test(prefix) ? Number(prefix) : 0;

    return length >= 1 && length <= bits && !isEveryIpv4Address(address, length);
}

// The issue goes on the variable itself, not on a list index: start-up prints errors only that deep.
const proxyList = z.string().transform((value, context) => {
    const entries = value.split(',').map((entry) => entry.trim());
    const refused = entries.find((entry) => !isAddressOrRange(entry));

    if (refused === undefined) return entries;

    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Not an IP address or CIDR range to trust: "' + refused + '"' });

    return z.NEVER;
});

/**
 * `TRUST_PROXY`: the comma-separated addresses of the reverse proxies whose X-Forwarded-For names the client,
 * for Fastify's `trustProxy`. Unset or blank = no proxy is trusted. `true` and hop counts are refused: both
 * would take an address that the client wrote itself.
 */
export const trustProxySchema = z.preprocess((value) => (typeof value === 'string' && !value.trim() ? undefined : value), proxyList.optional());
