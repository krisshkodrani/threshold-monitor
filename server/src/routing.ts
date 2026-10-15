import type {
  Alert,
  AlertRecord,
  ClientMessage,
  ErrorCode,
  SensorInfo,
  ServerMessage,
  SettingsRecord,
  SettingsValue,
} from "@app/protocol";
import type { AlertStore } from "./alertStore";
import type { ReadingsBuffer } from "./readingsBuffer";
import type { SettingsStore } from "./settingsStore";

export type Role = "monitor" | "control" | "sensor";

/**
 * Who sent a message: the role from hello; for people, the name and id from
 * the session; for the sensor, its info from hello.
 */
export type Sender =
  | { role: "monitor" | "control"; operator: string; userId: number }
  | { role: "sensor"; sensor: SensorInfo };

/** Who should receive a message. The relay maps this onto actual sockets. */
export type Outgoing = {
  to: "sender" | "monitors" | "views" | "sensor" | "everyone";
  message: ServerMessage;
};

export type RouteContext = {
  store: AlertStore;
  settings: SettingsStore;
  readings: ReadingsBuffer;
  /** The connected sensor, if any. */
  sensor: () => SensorInfo | null;
  now: () => string;
};

/**
 * The relay's rules, kept free of sockets so they can be tested directly.
 * The relay does no domain logic: it never decides whether something is a
 * crossing, it only validates who may say what, stores, and forwards.
 */
export function route(
  sender: Sender,
  message: ClientMessage,
  ctx: RouteContext,
): Outgoing[] {
  const { role } = sender;
  switch (message.type) {
    case "hello":
      return [error("NOT_ALLOWED", "Already identified.")];
    case "alert":
      return role === "sensor"
        ? routeAlert(message.alert, ctx)
        : [error("NOT_ALLOWED", "Only sensors send alerts.", message.alert.id)];
    case "ack":
      return sender.role === "control"
        ? routeAck(message.alertId, sender, ctx)
        : [
            error(
              "NOT_ALLOWED",
              "Only control rooms acknowledge.",
              message.alertId,
            ),
          ];
    case "reading":
      if (role !== "sensor")
        return [error("NOT_ALLOWED", "Only sensors send readings.")];
      ctx.readings.push(message.reading);
      return [{ to: "monitors", message }];
    case "settingsApplied":
      return sender.role === "sensor"
        ? routeSettingsApplied(sender.sensor, message.settings, ctx)
        : [error("NOT_ALLOWED", "Only sensors report their settings.")];
    case "setSettings":
      return sender.role === "monitor"
        ? routeSetSettings(message.settings, sender.operator, ctx)
        : [error("NOT_ALLOWED", "Only monitors change the settings.")];
  }
}

function routeAlert(alert: Alert, ctx: RouteContext): Outgoing[] {
  const existing = ctx.store.get(alert.id);
  if (existing) {
    // A resend after a lost `accepted`: confirm again, but do not alert
    // the views a second time (at-least-once made effectively-once).
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
    { to: "views", message: { type: "alert", record } },
  ];
}

/** The operator name comes from the sender's session, never from the message. */
function routeAck(
  alertId: string,
  { operator, userId }: { operator: string; userId: number },
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

  const updated = ctx.store.acknowledge(alertId, operator, ctx.now(), userId)!;
  // Everyone: other control rooms update their list, the monitors and the
  // sensor learn who acknowledged.
  return [
    {
      to: "everyone",
      message: acknowledged(alertId, updated.acknowledgement!),
    },
  ];
}

/**
 * The sensor reports the settings it starts with. The stored settings win:
 * only when the relay has none for this sensor do the sensor's defaults
 * become the shared settings.
 */
function routeSettingsApplied(
  sensor: SensorInfo,
  value: SettingsValue,
  ctx: RouteContext,
): Outgoing[] {
  if (ctx.settings.get(sensor.sensorId)) return [];
  const settings: SettingsRecord = { ...value, updatedBy: null, at: ctx.now() };
  ctx.settings.set(sensor.sensorId, settings);
  return [{ to: "monitors", message: { type: "settings", settings } }];
}

/** A monitor changes the shared settings: store them, then tell the sensor and all monitors. */
function routeSetSettings(
  value: SettingsValue,
  operator: string,
  ctx: RouteContext,
): Outgoing[] {
  const sensorId = ctx.sensor()?.sensorId ?? ctx.settings.latest()?.sensorId;
  if (!sensorId) return [error("NOT_ALLOWED", "No sensor has connected yet.")];
  const settings: SettingsRecord = {
    ...value,
    updatedBy: operator,
    at: ctx.now(),
  };
  ctx.settings.set(sensorId, settings);
  const message: ServerMessage = { type: "settings", settings };
  return [
    { to: "monitors", message },
    { to: "sensor", message },
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
