import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { App } from "./App";
import { fakeConnect, record } from "./test/fakes";

vi.mock("./components/AlarmList", () => ({
  AlarmList: () => {
    throw new Error("list failed");
  },
}));

test("an error in the alarm list leaves the header and the connection", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const relay = fakeConnect();
  render(
    <App
      connect={relay.connect}
      account={{ displayName: "Ada", onLogout: () => {} }}
    />,
  );
  act(() => relay.alive()[0]!.welcome([record(1)]));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "The alarm list cannot be shown because of an error.",
  );
  expect(screen.getByText(/unacknowledged/)).toHaveTextContent(
    "1 unacknowledged",
  );
  expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  expect(relay.alive()).toHaveLength(1); // the connection stays open
});
