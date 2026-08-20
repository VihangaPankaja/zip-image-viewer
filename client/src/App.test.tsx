import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import App from "./App";
import { formatMediaTime } from "./lib/formatterUtils";

describe("App bootstrap", () => {
  it("renders the workspace queue action", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "Media workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add to queue" }),
    ).toBeInTheDocument();
  });

  it("formats media time for player labels", () => {
    expect(formatMediaTime(0)).toBe("0:00");
    expect(formatMediaTime(65)).toBe("1:05");
    expect(formatMediaTime(3661)).toBe("1:01:01");
    expect(formatMediaTime(Number.NaN)).toBe("0:00");
  });
});
