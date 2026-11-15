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

export function checkArchiveFailure(output: string, supplied: boolean): void {
  if (
    /^(?:ERROR:\s*)?(?:Wrong password\b|Data Error in encrypted file\. Wrong password\?|Enter password(?: \(will not be echoed\))?:)/im.test(
      output,
    ) ||
    /(?:^| : )Can(?:not| not) open encrypted archive\. Wrong password\?\r?$/im.test(output)
  )
    throw new ArchivePasswordRequired(supplied);
  throw new Error("Archive is corrupt, incomplete or unsupported. Download the source again.");
}

export function encryptedArchiveListing(output: string): boolean {
  return /^(?:Encrypted = \+\r?$|Method = [^\r\n]*(?:7zAES|AES256|ZipCrypto)\b|Enter password(?: \(will not be echoed\))?:)/im.test(
    output,
  );
}
