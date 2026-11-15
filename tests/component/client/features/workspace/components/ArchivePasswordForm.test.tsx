import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vite-plus/test";
import { ArchivePasswordForm } from "../../../../../../client/src/features/workspace/components/ArchivePasswordForm";

test("submits a literal password once and clears the field before waiting for the server", async () => {
  const user = userEvent.setup();
  let finish = () => {};
  const submit = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<ArchivePasswordForm onSubmit={submit} />);
  const field = screen.getByLabelText("Archive password");
  await user.type(field, "$() literal secret");
  await user.keyboard("{Enter}");
  expect(submit).toHaveBeenCalledWith("$() literal secret");
  expect(field).toHaveValue("");
  expect(screen.getByRole("button", { name: "Unlock archive" })).toBeDisabled();
  finish();
  await waitFor(() => expect(field).toBeEnabled());
});
