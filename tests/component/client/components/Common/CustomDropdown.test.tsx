import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomDropdown } from "../../../../../client/src/components/Common/CustomDropdown";

describe("CustomDropdown", () => {
  it.each([true, false])("disables unavailable choices, disabled=%s", (disabled) => {
    render(
      <CustomDropdown
        id="sort"
        label="Sort"
        value="a"
        onChange={vi.fn()}
        disabled={disabled}
        options={disabled ? [{ value: "a", label: "Alpha" }] : []}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Sort" })).toBeDisabled();
  });
  it.each(["b", 2])("preserves the original option value type: %s", async (value) => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <CustomDropdown
        id="sort"
        label="Sort"
        value="a"
        options={[
          { value: "a", label: "Alpha" },
          { value, label: "Beta" },
        ]}
        onChange={onChange}
      />,
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), String(value));
    expect(onChange).toHaveBeenCalledWith(value);
  });
  it("uses labelled native options and exposes the full selected label", () => {
    render(
      <CustomDropdown
        id="quality"
        label="Quality"
        value="missing"
        options={[{ value: "auto", label: "Automatic preview quality" }]}
        onChange={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Quality" });
    expect(select).toHaveValue("auto");
    expect(select).toHaveAttribute("title", "Automatic preview quality");
    expect(screen.getByRole("option", { name: "Automatic preview quality" })).toBeInTheDocument();
  });
});
