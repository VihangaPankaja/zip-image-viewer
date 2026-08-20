import { useRef } from "react";

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
};

export function CustomDropdown({
  id,
  label,
  value,
  options,
  onChange,
  className = "",
}: CustomDropdownProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `${id}-menu`;
  const activeOption =
    options.find((option) => option.value === value) ?? options[0];

  return (
    <div
      className={`toolbar-select-shell custom-dropdown-shell ${className}`.trim()}
    >
      <span className="toolbar-label">{label}</span>
      <button
        type="button"
        id={id}
        className="custom-dropdown-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={menuId}
        popoverTarget={menuId}
      >
        <span>{activeOption?.label ?? "Select"}</span>
        <span className="custom-dropdown-caret" aria-hidden="true" />
      </button>

      <div
        ref={menuRef}
        id={menuId}
        className="custom-dropdown-menu"
        role="listbox"
        aria-label={label}
        popover="auto"
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
                menuRef.current?.hidePopover();
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
