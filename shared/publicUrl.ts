const blockedHostnames = new Set(["localhost", "localhost.localdomain"]);

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false;
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

export function isPublicHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    !blockedHostnames.has(hostname) &&
    !hostname.endsWith(".localhost") &&
    hostname !== "::1" &&
    !hostname.startsWith("fc") &&
    !hostname.startsWith("fd") &&
    !hostname.startsWith("fe80:") &&
    !isPrivateIpv4(hostname) &&
    !url.username &&
    !url.password
  );
}
