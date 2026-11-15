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
  if (/wrong password|password is incorrect|enter password/i.test(output))
    throw new ArchivePasswordRequired(supplied);
  throw new Error("Archive is corrupt, incomplete or unsupported. Download the source again.");
}
