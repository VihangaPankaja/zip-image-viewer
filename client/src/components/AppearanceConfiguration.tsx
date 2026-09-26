import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemePreference } from "../hooks/useLocalStorageSettings";

const THEME_OPTIONS = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

export function AppearanceConfiguration(props: {
  theme: ThemePreference;
  setTheme: (value: ThemePreference) => void;
}) {
  return (
    <fieldset className="settings-group settings-group-appearance">
      <legend>Appearance</legend>
      <p className="settings-hint">
        Follow your device, or choose a light or dark theme.
      </p>
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
    </fieldset>
  );
}
