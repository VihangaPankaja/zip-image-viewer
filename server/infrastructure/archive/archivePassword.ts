import { ApplicationError } from "../../domain/models.js";

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

export function checkArchiveFailure(output: string, supplied: boolean, archivePath: string): void {
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
    headerRejected
  )
    throw new ArchivePasswordRequired(supplied);
  throw new Error("Archive is corrupt, incomplete or unsupported. Download the source again.");
}

export function encryptedArchiveListing(output: string): boolean {
  return /^(?:Encrypted = \+\r?$|Method = [^\r\n]*(?:7zAES|AES256|ZipCrypto)\b|Enter password(?: \(will not be echoed\))?:)/im.test(
    output,
  );
}
