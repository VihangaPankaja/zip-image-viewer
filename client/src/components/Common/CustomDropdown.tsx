import { useRef, useState, type KeyboardEvent, type RefObject, type ToggleEvent } from "react";

type DropdownOptionValue = string | number;

type DropdownOption = {
  value: DropdownOptionValue;
  label: string;
};

type CustomDropdownProps = {
  id: string;
  label: string;
  value: DropdownOptionValue;
  options: DropdownOption[];
  onChange: (value: DropdownOptionValue) => void;
  className?: string;
  disabled?: boolean;
};

function useDropdownNavigation(
  menuRef: RefObject<HTMLDivElement | null>,
  triggerRef: RefObject<HTMLButtonElement | null>,
) {
  const search = useRef({ text: "", time: 0 });
  function close() {
    menuRef.current?.hidePopover();
    triggerRef.current?.focus();
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=option]")];
    const index = buttons.findIndex((button) => button === document.activeElement);
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = (index + 1) % buttons.length;
        break;
      case "ArrowUp":
        next = (index - 1 + buttons.length) % buttons.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = buttons.length - 1;
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      case "Tab":
        close();
        return;
      default: {
        if (
          event.key.length !== 1 ||
          event.key === " " ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        const now = event.timeStamp;
        search.current = {
          text:
            (now - search.current.time < 700 ? search.current.text : "") + event.key.toLowerCase(),
          time: now,
        };
        const query = search.current.text;
        const prefix = query.split("").every((letter) => letter === query[0])
          ? query.charAt(0)
          : query;
        next = buttons.findIndex((_, offset) =>
          buttons[(index + 1 + offset) % buttons.length]?.textContent
            ?.trim()
            .toLowerCase()
            .startsWith(prefix),
        );
        if (next >= 0) next = (index + 1 + next) % buttons.length;
      }
    }
    event.preventDefault();
    buttons[next]?.focus();
  }
  return {
    close,
    navigate,
    resetSearch: () => {
      search.current = { text: "", time: 0 };
    },
  };
}

function DropdownOptions({
  options,
  value,
  onChange,
}: Pick<CustomDropdownProps, "options" | "value" | "onChange">) {
  return options.map((option) => (
    <button
      key={option.value}
      type="button"
      role="option"
      aria-selected={option.value === value}
      tabIndex={-1}
      className={`custom-dropdown-option ${option.value === value ? "active" : ""}`}
      onClick={() => onChange(option.value)}
    >
      {option.label}
    </button>
  ));
}

export function CustomDropdown({
  id,
  label,
  value,
  options,
  onChange,
  className = "",
  disabled = false,
}: CustomDropdownProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { close, navigate, resetSearch } = useDropdownNavigation(menuRef, triggerRef);
  const [open, setOpen] = useState(false);
  const menuId = `${id}-menu`;
  const activeOption = options.find((option) => option.value === value) ?? options.at(0);
  function openWithArrow(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      menuRef.current?.showPopover();
    }
  }
  function toggle(event: ToggleEvent<HTMLDivElement>) {
    const opening = event.newState === "open";
    setOpen(opening);
    if (opening) {
      resetSearch();
      const menu = menuRef.current;
      (
        menu?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ??
        menu?.querySelector<HTMLButtonElement>("[role=option]")
      )?.focus();
    }
  }

  return (
    <div className={`toolbar-select-shell custom-dropdown-shell ${className}`.trim()}>
      <span className="toolbar-label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className="custom-dropdown-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={menuId}
        aria-expanded={open}
        disabled={disabled || options.length === 0}
        popoverTarget={menuId}
        onKeyDown={openWithArrow}
      >
        <span title={activeOption?.label}>{activeOption ? activeOption.label : "Select"}</span>
        <span className="custom-dropdown-caret" aria-hidden="true" />
      </button>

      <div
        ref={menuRef}
        id={menuId}
        className="custom-dropdown-menu"
        role="listbox"
        tabIndex={-1}
        aria-label={label}
        popover="auto"
        onToggle={toggle}
        onKeyDown={navigate}
      >
        <DropdownOptions
          options={options}
          value={value}
          onChange={(selection) => {
            onChange(selection);
            close();
          }}
        />
      </div>
    </div>
  );
}
