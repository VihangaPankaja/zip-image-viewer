function parseAppVersion(version) {
  if (
    typeof version !== "string" ||
    version.trim() !== version ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
  ) {
    throw new Error(`Invalid app version: ${version}. Expected major.minor.patch.`);
  }
  return version.split(".").map(BigInt);
}

export function validateAppVersion(version, baseVersion) {
  const current = parseAppVersion(version);
  if (baseVersion !== undefined) {
    const base = parseAppVersion(baseVersion);
    const changed = current.findIndex((part, index) => part !== base[index]);
    if (changed >= 0 && current[changed] < base[changed]) {
      throw new Error(`App version must not decrease: ${baseVersion} -> ${version}`);
    }
  }
  return version;
}

export function imageVersion(appVersion, runNumber, runAttempt) {
  validateAppVersion(appVersion);
  for (const counter of [runNumber, runAttempt]) {
    if (typeof counter !== "string" || counter.trim() !== counter || !/^[1-9]\d*$/.test(counter)) {
      throw new Error(`Invalid build counter: ${counter}`);
    }
  }
  const version = `${appVersion}-build.${runNumber}.${runAttempt}`;
  if (version.length > 128) throw new Error("Docker image versions must fit in 128 characters");
  return version;
}
