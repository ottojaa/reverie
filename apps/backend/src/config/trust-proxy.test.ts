import { describe, expect, it } from 'vitest';
import { trustProxySchema } from './trust-proxy.js';

describe('trustProxySchema', () => {
    it.each([undefined, '', '   '])('trusts nothing when the value is %o', (value) => {
        expect(trustProxySchema.parse(value)).toBeUndefined();
    });

    it.each([
        ['172.18.0.1', ['172.18.0.1']],
        [' 172.18.0.1 , 10.0.0.0/8,127.0.0.1/32 ', ['172.18.0.1', '10.0.0.0/8', '127.0.0.1/32']],
        ['::1,fd00::/8,2001:db8::1/128', ['::1', 'fd00::/8', '2001:db8::1/128']],
        ['::ffff:172.18.0.1,::ffff:172.18.0.0/112', ['::ffff:172.18.0.1', '::ffff:172.18.0.0/112']],
    ])('reads "%s" as a list', (value, list) => {
        expect(trustProxySchema.parse(value)).toEqual(list);
    });

    it.each([
        // Everything, hop counts and names.
        'true',
        'false',
        '1',
        '2',
        'loopback',
        'uniquelocal',
        'nginx',
        // Not an address or a prefix length.
        '172.18.0',
        '172.18.0.1:3000',
        '172.18.0.0/33',
        '::1/129',
        '172.18.0.0/',
        '172.18.0.0/16/8',
        '172.18.0.0/255.255.0.0',
        '172.18.0.1 172.18.0.2',
        'fe80::1%en0',
        // Ranges that hold every IPv4 address.
        '0.0.0.0/0',
        '::/0',
        '::/8',
        '::ffff:0:0/96',
        '::ffff:172.18.0.1/32',
        // One bad entry spoils the list.
        '172.18.0.1,',
        '172.18.0.1,true',
    ])('refuses "%s"', (value) => {
        const result = trustProxySchema.safeParse(value);

        expect(result.error?.issues[0]?.message).toMatch(/^Not an IP address or CIDR range to trust: /);
    });
});
