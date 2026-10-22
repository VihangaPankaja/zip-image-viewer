import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomDropdown } from "../../../../../client/src/components/Common/CustomDropdown";

describe("CustomDropdown", () => {
  it.each([true, false])("does not open a disabled or empty menu, disabled=%s", (disabled) => {
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
    expect(screen.getByRole("button", { name: "Sort" })).toBeDisabled();
  });
  it("moves focus with arrows, Home, End and typeahead without selecting", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CustomDropdown
        id="sort"
        label="Sort"
        value="a"
        onChange={onChange}
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
          { value: "c", label: "Charlie" },
        ]}
      />,
    );
    const [alpha, beta, charlie] = screen.getAllByRole("option", { hidden: true });
    alpha.focus();
    await user.keyboard("{ArrowDown}");
    expect(beta).toHaveFocus();
    await user.keyboard("{End}");
    expect(charlie).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(alpha).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(charlie).toHaveFocus();
    await user.keyboard("{Home}b");
    expect(beta).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.getByRole("button", { name: "Sort" })).toHaveFocus();
  });

  it("returns focus on Escape without changing the selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CustomDropdown
        id="sort"
        label="Sort"
        value="a"
        onChange={onChange}
        options={[{ value: "a", label: "Alpha" }]}
      />,
    );
    screen.getByRole("option", { hidden: true }).focus();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Sort" })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses a native popover while preserving controlled selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <CustomDropdown
        id="quality"
        label="Quality"
        value="auto"
        options={[
          { value: "auto", label: "Auto" },
          { value: "1080p", label: "1080p" },
        ]}
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Quality" });
    const listbox = screen.getByRole("listbox", { hidden: true });
    expect(trigger).toHaveAttribute("popovertarget", "quality-menu");
    expect(listbox).toHaveAttribute("popover", "auto");
    expect(listbox).toHaveAttribute("aria-label", "Quality");

    await user.click(screen.getByRole("option", { name: "1080p", hidden: true }));
    expect(onChange).toHaveBeenCalledWith("1080p");
  });
});
