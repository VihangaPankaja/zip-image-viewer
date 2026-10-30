import { act, renderHook } from "@testing-library/react";
import { useLocalStorageSettings } from "../../../../client/src/hooks/useLocalStorageSettings";
import { useWorkspacePageState } from "../../../../client/src/features/workspace/useWorkspacePageState";
import { useWorkspaceHistory } from "../../../../client/src/features/workspace/useWorkspaceHistory";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  vi.restoreAllMocks();
});

it("keeps a saved sort order when opening the workspace without a route", () => {
  window.history.replaceState(null, "", "/");
  localStorage.setItem("zip-explorer-sort", "name-desc");
  const { result } = renderHook(() => {
    const state = useWorkspacePageState();
    useWorkspaceHistory(state, {
      openSession: vi.fn().mockResolvedValue(undefined),
      abortNavigation: vi.fn(),
      setError: vi.fn(),
      isOpening: false,
    });
    return state;
  });
  expect(result.current.sortMode).toBe("name-desc");
  expect(localStorage.getItem("zip-explorer-sort")).toBe("name-desc");
});

it("resets device preferences without deleting content metadata or playback positions", () => {
  localStorage.setItem("zip-video-resume-session-file", "45");
  localStorage.setItem("unrelated-content", "keep");
  const { result } = renderHook(useLocalStorageSettings);
  act(() => {
    result.current.setTheme("dark");
    result.current.setAccent("rose");
    result.current.setKeyboardSettings({ jumpSeconds: 20, rateStep: 0.5 });
  });
  act(() => result.current.resetDevicePreferences());
  expect(result.current.theme).toBe("system");
  expect(result.current.accent).toBe("teal");
  expect(result.current.keyboardSettings).toEqual({ jumpSeconds: 5, rateStep: 0.25 });
  expect(localStorage.getItem("zip-video-resume-session-file")).toBe("45");
  expect(localStorage.getItem("unrelated-content")).toBe("keep");
});

it("follows system appearance, persists overrides, and removes its media listener", () => {
  let onChange = () => {};
  const removeEventListener = vi.fn();
  const preference = {
    matches: false,
    addEventListener: vi.fn((_event: string, handler: () => void) => {
      onChange = handler;
    }),
    removeEventListener,
  };
  vi.spyOn(window, "matchMedia").mockReturnValue(preference as unknown as MediaQueryList);
  localStorage.setItem("zip-image-viewer-theme", "invalid");
  const { result, unmount } = renderHook(useLocalStorageSettings);
  expect(result.current.theme).toBe("system");
  expect(result.current.darkSurface).toBe("charcoal");
  expect(result.current.accent).toBe("teal");
  expect(document.documentElement.dataset.theme).toBe("light");
  act(() => {
    preference.matches = true;
    onChange();
  });
  expect(document.documentElement.dataset.theme).toBe("dark");
  act(() => result.current.setTheme("light"));
  expect(localStorage.getItem("zip-image-viewer-theme")).toBe("light");
  act(() => onChange());
  expect(document.documentElement.dataset.theme).toBe("light");
  unmount();
  expect(removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  const restored = renderHook(useLocalStorageSettings);
  expect(restored.result.current.theme).toBe("light");
});

it("persists valid explorer and preview preferences and rejects unsupported values", () => {
  localStorage.setItem("zip-explorer-sort", "unsupported");
  const view = renderHook(useWorkspacePageState);
  expect(view.result.current.sortMode).toBe("natural-tail");
  act(() => {
    view.result.current.setSortMode("name-desc");
    view.result.current.setPreviewQuality("high");
  });
  view.unmount();
  const restored = renderHook(useWorkspacePageState);
  expect(restored.result.current.sortMode).toBe("name-desc");
  expect(restored.result.current.previewQuality).toBe("high");
});

it("keeps settings usable when browser storage is unavailable", () => {
  vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
    throw new DOMException("Storage blocked", "SecurityError");
  });
  vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("Storage blocked", "SecurityError");
  });
  const settings = renderHook(useLocalStorageSettings);
  const workspace = renderHook(useWorkspacePageState);
  expect(settings.result.current.theme).toBe("system");
  expect(workspace.result.current.sortMode).toBe("natural-tail");
  act(() => {
    settings.result.current.setTheme("dark");
    settings.result.current.setDarkSurface("amoled");
    settings.result.current.setAccent("rose");
    workspace.result.current.setSortMode("name-desc");
  });
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(workspace.result.current.sortMode).toBe("name-desc");
  expect(document.documentElement.dataset.darkSurface).toBe("amoled");
  expect(document.documentElement.dataset.accent).toBe("rose");
  expect(settings.result.current.accentSaveError).toBe(true);
});

it.each(["teal", "blue", "violet", "amber", "rose"] as const)(
  "restores %s independently of existing mode and surface settings",
  (accent) => {
    localStorage.setItem("zip-image-viewer-theme", "dark");
    localStorage.setItem("zip-image-viewer-dark-surface", "amoled");
    localStorage.setItem("zip-image-viewer-accent", "unsupported");
    const view = renderHook(useLocalStorageSettings);
    expect(view.result.current.accent).toBe("teal");
    act(() => view.result.current.setAccent(accent));
    expect(document.documentElement.dataset.accent).toBe(accent);
    expect(localStorage.getItem("zip-image-viewer-accent")).toBe(accent);
    expect(view.result.current.accentSaveError).toBe(false);
    view.unmount();
    const restored = renderHook(useLocalStorageSettings);
    expect(restored.result.current.accent).toBe(accent);
    expect(restored.result.current.theme).toBe("dark");
    expect(restored.result.current.darkSurface).toBe("amoled");
  },
);

it("restores dark surfaces independently of mode and rejects invalid saved surfaces", () => {
  localStorage.setItem("zip-image-viewer-theme", "dark");
  localStorage.setItem("zip-image-viewer-dark-surface", "invalid");
  const view = renderHook(useLocalStorageSettings);
  expect(view.result.current.darkSurface).toBe("charcoal");
  act(() => view.result.current.setDarkSurface("amoled"));
  expect(document.documentElement.dataset.darkSurface).toBe("amoled");
  expect(localStorage.getItem("zip-image-viewer-dark-surface")).toBe("amoled");
  act(() => view.result.current.setTheme("light"));
  view.unmount();
  const restored = renderHook(useLocalStorageSettings);
  expect(restored.result.current.theme).toBe("light");
  expect(restored.result.current.darkSurface).toBe("amoled");
});
