import React from "react";
import { render, screen } from "@testing-library/react";
import App from "./App";
import { formatMediaTime } from "./lib/formatterUtils";

describe("App bootstrap", () => {
  it("renders Download tab controls", () => {
    render(<App />);
    expect(screen.getByText("Download")).toBeInTheDocument();
    expect(screen.getByText("Open file")).toBeInTheDocument();
  });

  it("formats media time for player labels", () => {
    expect(formatMediaTime(0)).toBe("0:00");
    expect(formatMediaTime(65)).toBe("1:05");
    expect(formatMediaTime(3661)).toBe("1:01:01");
    expect(formatMediaTime(Number.NaN)).toBe("0:00");
  });
});
