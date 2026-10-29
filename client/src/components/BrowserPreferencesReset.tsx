import { useState } from "react";

export function BrowserPreferencesReset({ onReset }: { onReset: () => void }) {
  const [reset, setReset] = useState(false);
  return (
    <fieldset className="settings-group">
      <legend>This browser</legend>
      <p>
        Reset appearance, download defaults, shortcuts and explorer preferences. Downloaded files,
        playback positions and server transfer limits are kept.
      </p>
      <button
        className="ghost-button"
        type="button"
        onClick={() => {
          onReset();
          setReset(true);
        }}
      >
        Reset browser preferences
      </button>
      {reset ? (
        <p role="status">Browser preferences reset. Files and server limits are kept.</p>
      ) : null}
    </fieldset>
  );
}
