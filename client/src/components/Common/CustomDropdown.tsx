type DropdownOptionValue = string | number;
type DropdownOption = { value: DropdownOptionValue; label: string };
type CustomDropdownProps = {
  id: string;
  label: string;
  value: DropdownOptionValue;
  options: DropdownOption[];
  onChange: (value: DropdownOptionValue) => void;
  className?: string;
  disabled?: boolean;
};

export function CustomDropdown({
  id,
  label,
  value,
  options,
  onChange,
  className = "",
  disabled = false,
}: CustomDropdownProps) {
  const selected = options.find((option) => option.value === value) ?? options.at(0);
  return (
    <label
      className={`toolbar-select-shell custom-dropdown-shell ${className}`.trim()}
      htmlFor={id}
    >
      <span className="toolbar-label">{label}</span>
      <select
        id={id}
        value={selected ? String(selected.value) : ""}
        title={selected?.label}
        disabled={disabled || options.length === 0}
        onChange={(event) => {
          const option = options.find((item) => String(item.value) === event.currentTarget.value);
          if (option) onChange(option.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
