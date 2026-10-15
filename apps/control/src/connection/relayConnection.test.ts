import { encode, type ServerMessage } from "@app/protocol";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { uuid } from "../test/fakes";
import {
  backoffDelay,
  CLOSE_UNAUTHORIZED,
  CLOSE_UNSUPPORTED_VERSION,
  createRelayConnection,
  relayUrl,
  type ConnectionStatus,
  type SocketEvents,
} from "./relayConnection";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** One fake socket per connection attempt; the test drives its events. */
function setup() {
  const sockets: { events: SocketEvents; sent: string[]; closed: boolean }[] =
    [];
  const statuses: ConnectionStatus[] = [];
  const messages: ServerMessage[] = [];
  const log = vi.fn();
  const connection = createRelayConnection(
    {
      url: "ws://test.local/ws",
      clientName: "Control room",
      createSocket: (_url, events) => {
        const socket = { events, sent: [] as string[], closed: false };
        sockets.push(socket);
        return {
          send: (data) => socket.sent.push(data),
          close: () => (socket.closed = true),
        };
      },
      random: () => 0,
      log,
    },
    {
      onStatus: (s) => statuses.push(s),
      onMessage: (m) => messages.push(m),
    },
  );
  const last = () => sockets.at(-1)!;
  const welcome = () =>
    last().events.message(
      encode({ type: "welcome", connectionId: uuid(1), recent: [] }),
    );
  return { connection, sockets, statuses, messages, log, last, welcome };
}

test("says hello as a control room, then reports open on welcome", () => {
  const { last, welcome, statuses, messages } = setup();
  last().events.open();
  expect(JSON.parse(last().sent[0]!)).toEqual({
    type: "hello",
    v: 2,
    role: "control",
    clientName: "Control room",
  });
  welcome();
  expect(statuses.map((s) => s.kind)).toEqual(["connecting", "open"]);
  expect(messages[0]?.type).toBe("welcome");
});

test("send works only on a welcomed connection", () => {
  const { connection, last, welcome } = setup();
  const ack = { type: "ack", alertId: uuid(2), operator: "Ada" } as const;
  last().events.open();
  expect(connection.send(ack)).toBe(false);
  welcome();
  expect(connection.send(ack)).toBe(true);
  expect(JSON.parse(last().sent.at(-1)!)).toEqual(ack);
});

test("reconnects with growing delays and resets them after a welcome", () => {
  const { sockets, statuses, last, welcome } = setup();
  last().events.close(1006);
  expect(statuses.at(-1)).toMatchObject({ kind: "reconnecting", attempt: 1 });
  vi.advanceTimersByTime(backoffDelay(0, () => 0));
  expect(sockets).toHaveLength(2);

  last().events.close(1006);
  expect(statuses.at(-1)).toMatchObject({ kind: "reconnecting", attempt: 2 });
  vi.advanceTimersByTime(backoffDelay(1, () => 0));
  last().events.open();
  welcome();

  last().events.close(1001);
  expect(statuses.at(-1)).toMatchObject({ kind: "reconnecting", attempt: 1 });
});

test("an unsupported protocol version closes for good", () => {
  const { sockets, statuses, last } = setup();
  last().events.close(CLOSE_UNSUPPORTED_VERSION);
  vi.advanceTimersByTime(60_000);
  expect(statuses.at(-1)).toEqual({ kind: "closed" });
  expect(sockets).toHaveLength(1);
});

test("unauthorized (4003) stops for good with status signedOut", () => {
  const { sockets, statuses, last } = setup();
  last().events.close(CLOSE_UNAUTHORIZED);
  vi.advanceTimersByTime(60_000);
  expect(statuses.at(-1)).toEqual({ kind: "signedOut" });
  expect(sockets).toHaveLength(1);
});

test("invalid server messages are logged and ignored", () => {
  const { last, messages, log } = setup();
  last().events.message("not json");
  expect(messages).toEqual([]);
  expect(log).toHaveBeenCalledOnce();
});

test("dispose closes the socket and stops retries", () => {
  const { connection, sockets, statuses, last } = setup();
  last().events.close(1006);
  connection.dispose();
  vi.advanceTimersByTime(60_000);
  expect(sockets).toHaveLength(1);
  expect(statuses.at(-1)).toEqual({ kind: "closed" });
  expect(vi.getTimerCount()).toBe(0);
});

test("relayUrl follows the page protocol and host", () => {
  expect(relayUrl({ protocol: "https:", host: "example.com" })).toBe(
    "wss://example.com/ws",
  );
});
