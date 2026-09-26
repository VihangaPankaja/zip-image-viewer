import { act, renderHook } from "@testing-library/react";
import { useLocalStorageSettings } from "./useLocalStorageSettings";
import { useWorkspacePageState } from "../features/workspace/useWorkspacePageState";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
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
  vi.spyOn(window, "matchMedia").mockReturnValue(
    preference as unknown as MediaQueryList,
  );
  localStorage.setItem("zip-image-viewer-theme", "invalid");
  const { result, unmount } = renderHook(useLocalStorageSettings);
  expect(result.current.theme).toBe("system");
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
  expect(removeEventListener).toHaveBeenCalledWith(
    "change",
    expect.any(Function),
  );
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
    workspace.result.current.setSortMode("name-desc");
  });
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(workspace.result.current.sortMode).toBe("name-desc");
});
