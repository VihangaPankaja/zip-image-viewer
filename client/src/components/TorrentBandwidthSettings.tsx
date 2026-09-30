import { useState } from "react";
import type { TorrentLimits } from "../../../shared/contracts";

export function TorrentBandwidthSettings({
  torrentLimits,
  onSetTorrentLimits,
}: {
  torrentLimits: TorrentLimits;
  onSetTorrentLimits: (limits: TorrentLimits) => Promise<void>;
}) {
  const [download, setDownload] = useState(
    String(torrentLimits.downloadBytesPerSec / 1024),
  );
  const [upload, setUpload] = useState(
    String(torrentLimits.uploadBytesPerSec / 1024),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    const down = Number(download);
    const up = Number(upload);
    if (
      !download.trim() ||
      !upload.trim() ||
      ![down, up].every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 1_048_576,
      )
    ) {
      setError("Enter whole KiB/s values from 0 to 1048576.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSetTorrentLimits({
        downloadBytesPerSec: down * 1024,
        uploadBytesPerSec: up * 1024,
      });
    } catch {
      setError("Could not update torrent limits. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <fieldset className="settings-group">
      <legend>Torrent bandwidth</legend>
      <p className="settings-hint">
        Limits are shared across active torrents. Set 0 for unlimited. HTTP
        downloads are unaffected.
      </p>
      <label className="input-shell">
        <span className="input-label">Torrent download limit (KiB/s)</span>
        <input
          type="number"
          min="0"
          max="1048576"
          step="1"
          value={download}
          onChange={(event) => setDownload(event.currentTarget.value)}
        />
      </label>
      <label className="input-shell">
        <span className="input-label">Torrent upload limit (KiB/s)</span>
        <input
          type="number"
          min="0"
          max="1048576"
          step="1"
          value={upload}
          onChange={(event) => setUpload(event.currentTarget.value)}
        />
      </label>
      <button type="button" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save torrent limits"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </fieldset>
  );
}
