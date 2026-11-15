import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { isPublicHttpUrl } from "../../../shared/publicUrl.js";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
blocked.addSubnet("2001::", 32, "ipv6");

function assertPublicAddress(address: string) {
  const family = isIP(address);
  if (
    !family ||
    blocked.check(address, family === 4 ? "ipv4" : "ipv6") ||
    (family === 6 && !globalV6.check(address, "ipv6"))
  ) {
    throw new Error("Page inspection requires a public network address.");
  }
}

export function assertPublicPageUrl(value: string | URL) {
  if (String(value).length > 2048 || !isPublicHttpUrl(String(value)))
    throw new Error("A public HTTP(S) page URL is required.");
  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) assertPublicAddress(hostname);
}

// Validate and return the same resolved address to the socket, preventing DNS rebinding.
export const publicPageLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, options, (error, address, family) => {
    if (error) {
      callback(error, address, family);
      return;
    }
    try {
      for (const item of typeof address === "string"
        ? [address]
        : address.map((item) => item.address))
        assertPublicAddress(item);
      callback(null, address, family);
    } catch (failure) {
      callback(failure instanceof Error ? failure : new Error(String(failure)), "", 0);
    }
  });
};
