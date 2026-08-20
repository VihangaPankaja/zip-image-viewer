import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import App from "./App";

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
    expect(screen.getByRole("region", { name: "Details" })).toBeInTheDocument();
  });
});
