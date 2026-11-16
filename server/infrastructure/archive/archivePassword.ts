import { ApplicationError } from "../../domain/models.js";
import path from "node:path";

export class ArchivePasswordRequired extends ApplicationError {
  constructor(rejected = false) {
    super(
      "PASSWORD_REQUIRED",
      rejected
        ? "Password was rejected or encrypted data is damaged. Try another password; if it persists, download the source again."
        : "This archive needs a password.",
      409,
    );
  }
}

export function checkArchiveFailure(
  output: string,
  supplied: boolean,
  archivePath: string,
  listing = "",
): void {
  if (/^ERROR: Unsupported Method(?:\s*:.*)?$/im.test(output))
    throw new ApplicationError(
      "INVALID_INPUT",
      "Unsupported archive compression method. Repack the source as ZIP with Store/Deflate or 7z with LZMA/LZMA2, then add it again.",
      400,
    );
  const prefix = `ERROR: ${archivePath} : `;
  const headerRejected = output.split(/\r?\n/).some((line) => {
    const diagnostic = line.startsWith(prefix)
      ? line.slice(prefix.length)
      : line.replace(/^ERROR:\s*/, "");
    return /^Can(?:not| not) open encrypted archive\. Wrong password\?$/.test(diagnostic);
  });
  if (
    /^(?:ERROR:\s*)?(?:Wrong password\b|Data Error in encrypted file\. Wrong password\?|Enter password(?: \(will not be echoed\))?:)/im.test(
      output,
    ) ||
    headerRejected ||
    (!output.trim() && splitHeaderRejected(listing, archivePath))
  )
    throw new ArchivePasswordRequired(supplied);
  throw new Error("Archive is corrupt, incomplete or unsupported. Download the source again.");
}

function splitHeaderRejected(listing: string, archivePath: string): boolean {
  if (!/\.7z\.\d+$/i.test(archivePath)) return false;
  const sections = listing.replace(/\r/g, "").split(/^----------$/m);
  if (sections.length !== 3) return false;
  const [header, container, failure] = sections;
  const headerLines = header.split("\n");
  const name = path.basename(archivePath).replace(/\.\d+$/, "");
  const containerLines = container.trim().split("\n");
  // Bind p7zip's failed Split wrapper to the source and its unopened inner archive.
  return (
    headerLines.includes(`Path = ${archivePath}`) &&
    headerLines.includes("Type = Split") &&
    /^Enter password(?: \(will not be echoed\))?:/m.test(header) &&
    containerLines.length === 2 &&
    containerLines[0] === `Path = ${name}` &&
    /^Size = \d+$/.test(containerLines[1]) &&
    failure.trim() ===
      `Path = ${name}\nOpen ERROR: Can not open the file as [7z] archive\n\nErrors: 1`
  );
}

export function encryptedArchiveListing(output: string): boolean {
  return /^(?:Encrypted = \+\r?$|Method = [^\r\n]*(?:7zAES|AES256|ZipCrypto)\b|Enter password(?: \(will not be echoed\))?:)/im.test(
    output,
  );
}
