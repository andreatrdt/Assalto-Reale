import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnlinePage } from "../pages/OnlinePage";

const navigate = vi.fn();

afterEach(() => {
  navigate.mockReset();
  vi.unstubAllEnvs();
});

describe("online multiplayer presentation", () => {
  it("renders the visible host and join experience when no server is configured", () => {
    const html = renderToStaticMarkup(<OnlinePage route="/online" navigate={navigate} />);

    expect(html).toContain("Play Online");
    expect(html).toContain("Create a private match");
    expect(html).toContain("Enter an invite code");
    expect(html).toContain("Server not configured");
    expect(html).toContain("Create Online Match");
    expect(html).toContain("Join Match");
  });
});
