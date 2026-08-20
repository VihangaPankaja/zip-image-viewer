import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomDropdown } from "./CustomDropdown";

describe("CustomDropdown", () => {
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

    await user.click(
      screen.getByRole("option", { name: "1080p", hidden: true }),
    );
    expect(onChange).toHaveBeenCalledWith("1080p");
  });
});
