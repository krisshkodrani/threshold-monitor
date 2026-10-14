import type {
  Alert,
  AlertRecord,
  ClientMessage,
  ErrorCode,
  ServerMessage,
} from "@app/protocol";
import type { AlertStore } from "./alertStore";

export type Role = "monitor" | "control";

/** Who should receive a message. The relay maps this onto actual sockets. */
export type Outgoing = {
  to: "sender" | "controls" | "everyone";
  message: ServerMessage;
};

export type RouteContext = { store: AlertStore; now: () => string };

/**
 * The relay's rules, kept free of sockets so they can be tested directly.
 * The relay does no domain logic: it never decides whether something is a
 * crossing, it only validates who may say what, stores, and forwards.
 */
export function route(
  role: Role,
  message: ClientMessage,
  ctx: RouteContext,
): Outgoing[] {
  switch (message.type) {
    case "hello":
      return [error("NOT_ALLOWED", "Already identified.")];
    case "alert":
      return role === "monitor"
        ? routeAlert(message.alert, ctx)
        : [
            error(
              "NOT_ALLOWED",
              "Only monitors send alerts.",
              message.alert.id,
            ),
          ];
    case "ack":
      return role === "control"
        ? routeAck(message.alertId, message.operator, ctx)
        : [
            error(
              "NOT_ALLOWED",
              "Only control rooms acknowledge.",
              message.alertId,
            ),
          ];
  }
}

function routeAlert(alert: Alert, ctx: RouteContext): Outgoing[] {
  const existing = ctx.store.get(alert.id);
  if (existing) {
    // A resend after a lost `accepted`: confirm again, but do not alert
    // the control rooms a second time (at-least-once made effectively-once).
    return [toSender(existing, true)];
  }

  // The server stamps its own receipt time; nothing else is added or trusted.
  const record: AlertRecord = {
    ...alert,
    receivedAt: ctx.now(),
    acknowledgement: null,
  };
  ctx.store.add(record);
  return [
    toSender(record, false),
    { to: "controls", message: { type: "alert", record } },
  ];
}

function routeAck(
  alertId: string,
  operator: string,
  ctx: RouteContext,
): Outgoing[] {
  const record = ctx.store.get(alertId);
  if (!record)
    return [
      error("UNKNOWN_ALERT", "No such alert (never seen or expired).", alertId),
    ];

  if (record.acknowledgement) {
    // First acknowledgement wins; tell this operator who got there first.
    return [
      { to: "sender", message: acknowledged(alertId, record.acknowledgement) },
    ];
  }

  const updated = ctx.store.acknowledge(alertId, operator, ctx.now())!;
  // Everyone: other control rooms update their list, the monitor shows who acknowledged.
  return [
    {
      to: "everyone",
      message: acknowledged(alertId, updated.acknowledgement!),
    },
  ];
}

function toSender(record: AlertRecord, duplicate: boolean): Outgoing {
  return {
    to: "sender",
    message: {
      type: "accepted",
      alertId: record.id,
      receivedAt: record.receivedAt,
      duplicate,
    },
  };
}

function acknowledged(
  alertId: string,
  ack: { operator: string; at: string },
): ServerMessage {
  return { type: "acknowledged", alertId, operator: ack.operator, at: ack.at };
}

export function error(
  code: ErrorCode,
  message: string,
  ref?: string,
): Outgoing {
  return {
    to: "sender",
    message: { type: "error", code, message, ...(ref ? { ref } : {}) },
  };
}
