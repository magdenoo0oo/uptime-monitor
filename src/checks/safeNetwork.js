import dns from 'node:dns';
import net from 'node:net';
import { Agent } from 'undici';

/**
 * SSRF protection.
 *
 * Users give us URLs and our server fetches them. Without a guard, someone
 * could add http://localhost:27017 or http://169.254.169.254 (cloud metadata)
 * and use our server to probe the private network behind it.
 *
 * The check happens at connect time, inside the DNS lookup, so it also stops
 * "DNS rebinding" (a domain that resolves to a public IP when the monitor is
 * created and to 127.0.0.1 later).
 */
const blocked = new net.BlockList();
// IPv4
blocked.addSubnet('0.0.0.0', 8, 'ipv4'); // "this" network
blocked.addSubnet('10.0.0.0', 8, 'ipv4'); // private
blocked.addSubnet('100.64.0.0', 10, 'ipv4'); // carrier-grade NAT
blocked.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
blocked.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local, cloud metadata
blocked.addSubnet('172.16.0.0', 12, 'ipv4'); // private
blocked.addSubnet('192.0.0.0', 24, 'ipv4'); // IETF protocol assignments
blocked.addSubnet('192.168.0.0', 16, 'ipv4'); // private
blocked.addSubnet('198.18.0.0', 15, 'ipv4'); // benchmarking
blocked.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
blocked.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved + broadcast
// IPv6
blocked.addAddress('::', 'ipv6'); // unspecified
blocked.addAddress('::1', 'ipv6'); // loopback
blocked.addSubnet('fc00::', 7, 'ipv6'); // unique local
blocked.addSubnet('fe80::', 10, 'ipv6'); // link-local
blocked.addSubnet('ff00::', 8, 'ipv6'); // multicast

export function isPrivateAddress(address) {
  const ip = address.replace(/^\[|\]$/g, '');
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:127.0.0.1) → check the embedded IPv4 address.
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(ip, 'ipv6');
  }
  return false;
}

export class BlockedAddressError extends Error {
  constructor(address) {
    super(`Blocked: ${address} is a private or reserved address`);
    this.code = 'EBLOCKED';
  }
}

/** Drop-in replacement for dns.lookup that refuses private addresses. */
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const bad = addresses.find((a) => isPrivateAddress(a.address));
    if (bad) return callback(new BlockedAddressError(bad.address));
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

/**
 * Node skips DNS lookup for IP literals (http://127.0.0.1), so those are
 * checked here, both when a monitor is saved and before every request.
 */
export function assertPublicUrl(url) {
  const { hostname } = new URL(url);
  if (net.isIP(hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(hostname)) {
    throw new BlockedAddressError(hostname);
  }
}

// Note: undici's request() does not follow redirects. A 3xx counts as "up" by
// default, and following redirects could lead the request to a private address.
export function createDispatcher({ allowPrivate }) {
  return new Agent({
    connect: allowPrivate ? {} : { lookup: safeLookup },
    keepAliveTimeout: 1000, // checks are minutes apart; don't hold sockets open
  });
}
