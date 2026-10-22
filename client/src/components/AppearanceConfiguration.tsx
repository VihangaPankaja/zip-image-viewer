import { Monitor, Moon, Sun } from "lucide-react";
import type { Accent, DarkSurface, ThemePreference } from "../hooks/useLocalStorageSettings";

const THEME_OPTIONS = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

type AccentSettings = {
  accent: Accent;
  setAccent: (value: Accent) => void;
  accentSaveError: boolean;
};

function AccentConfiguration(props: AccentSettings) {
  return (
    <fieldset className="accent-options">
      <legend>Accent</legend>
      <p className="settings-hint">Used in both light and dark themes.</p>
      <div className="theme-options accent-choices">
        {(["teal", "blue", "violet", "amber", "rose"] as const).map((value) => (
          <label className="theme-option" key={value}>
            <input
              type="radio"
              name="accent"
              value={value}
              checked={props.accent === value}
              onChange={() => props.setAccent(value)}
            />
            <span>{value[0].toUpperCase() + value.slice(1)}</span>
          </label>
        ))}
      </div>
      {props.accentSaveError ? (
        <p className="settings-hint" role="status">
          Accent applies to this tab. Browser storage is unavailable, so it cannot be saved.
        </p>
      ) : null}
    </fieldset>
  );
}

export function AppearanceConfiguration(
  props: AccentSettings & {
    darkSurface: DarkSurface;
    setDarkSurface: (value: DarkSurface) => void;
    theme: ThemePreference;
    setTheme: (value: ThemePreference) => void;
  },
) {
  return (
    <fieldset className="settings-group settings-group-appearance">
      <legend>Appearance</legend>
      <p className="settings-hint">Follow your device, or choose a light or dark theme.</p>
      <div className="theme-options">
        {THEME_OPTIONS.map(({ value, label, Icon }) => (
          <label className="theme-option" key={value}>
            <input
              type="radio"
              name="theme"
              value={value}
              checked={props.theme === value}
              onChange={() => props.setTheme(value)}
            />
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <fieldset className="dark-surface-options">
        <legend>Dark surfaces</legend>
        <p className="settings-hint">Used in Dark mode and when System switches to dark.</p>
        <div className="theme-options dark-surface-choices">
          {(["charcoal", "amoled"] as const).map((value) => (
            <label className="theme-option" key={value}>
              <input
                type="radio"
                name="dark-surface"
                value={value}
                checked={props.darkSurface === value}
                onChange={() => props.setDarkSurface(value)}
              />
              <span>{value === "amoled" ? "AMOLED" : "Charcoal"}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <AccentConfiguration {...props} />
    </fieldset>
  );
}
