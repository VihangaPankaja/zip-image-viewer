import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App bootstrap", () => {
  it("renders separate Downloads and Explore views", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("tab", { name: "Downloads" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Explore" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add downloads" }),
    ).toBeInTheDocument();
  });
});
