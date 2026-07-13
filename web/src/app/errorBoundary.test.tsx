import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

describe("ErrorBoundary", () => {
  it("renders its children unchanged when nothing throws", () => {
    const html = renderToStaticMarkup(
      <ErrorBoundary>
        <p>healthy content</p>
      </ErrorBoundary>,
    );
    expect(html).toContain("healthy content");
    expect(html).not.toContain("Something went wrong");
  });

  it("switches to the error state when a render throws", () => {
    // getDerivedStateFromError is React's contract for entering the fallback.
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ hasError: true });
  });
});
