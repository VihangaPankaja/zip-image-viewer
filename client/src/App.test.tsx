import React from "react";
import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App bootstrap", () => {
  it("renders Download tab controls", () => {
    render(<App />);
    expect(screen.getByText("Download")).toBeInTheDocument();
    expect(screen.getByText("Open file")).toBeInTheDocument();
  });
});
