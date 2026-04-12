import React, { useEffect, useRef, useState } from "react";

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
  onChange: (_value: DropdownOptionValue) => void;
  className?: string;
};

export function CustomDropdown({
  id,
  label,
  value,
  options,
  onChange,
  className = "",
}: CustomDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeOption =
    options.find((option) => option.value === value) || options[0] || null;

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);

    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={`toolbar-select-shell custom-dropdown-shell ${className}`.trim()}
    >
      <span className="toolbar-label">{label}</span>
      <button
        type="button"
        id={id}
        className={`custom-dropdown-trigger ${open ? "open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{activeOption?.label || "Select"}</span>
        <span className="custom-dropdown-caret">{open ? "^" : "v"}</span>
      </button>

      {open ? (
        <div
          className="custom-dropdown-menu"
          role="listbox"
          aria-labelledby={id}
        >
          {options.map((option) => {
            const isActive = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`custom-dropdown-option ${isActive ? "active" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
