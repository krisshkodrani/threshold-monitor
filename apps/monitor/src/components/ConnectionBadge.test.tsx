import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ConnectionStatus } from "../transport/AlertTransport";
import { ConnectionBadge } from "./ConnectionBadge";

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});
afterEach(() => {
  vi.useRealTimers();
});

test.each<[ConnectionStatus, string]>([
  [{ kind: "open" }, "Connected"],
  [{ kind: "connecting" }, "Connecting…"],
  [{ kind: "closed" }, "Disconnected"],
  [{ kind: "signedOut" }, "Signed out"],
  [
    { kind: "reconnecting", attempt: 2, retryAt: 3000 },
    "Reconnecting (attempt 2)",
  ],
])("announces %j as %s", (status, text) => {
  render(<ConnectionBadge status={status} />);
  expect(screen.getByRole("status")).toHaveTextContent(text);
});

test("shows a countdown to the next retry outside the live region", () => {
  render(
    <ConnectionBadge
      status={{ kind: "reconnecting", attempt: 2, retryAt: 3000 }}
    />,
  );
  expect(screen.getByText(/retry in 3 s/)).toBeInTheDocument();
  expect(screen.getByRole("status")).not.toHaveTextContent("retry");
});
