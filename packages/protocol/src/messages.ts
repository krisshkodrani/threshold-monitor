import { z } from "zod";

/**
 * 2: the ack has no operator; the server takes it from the session (ADR 0006).
 * 3: a sensor agent sends the readings and the alerts; monitors only view
 *    them and change the shared settings (ADR 0009).
 */
export const PROTOCOL_VERSION = 3;
/** Enforced by the server as the WebSocket maxPayload. */
export const MAX_MESSAGE_BYTES = 16 * 1024;
/** How many recent alerts a welcome message carries at most. */
export const WELCOME_RECENT_LIMIT = 100;
/** How many recent readings a welcome message carries at most (the chart window). */
export const WELCOME_READINGS_LIMIT = 120;
/** The allowed detection settings, checked by the relay and the monitor form. */
export const SETTINGS_LIMITS = {
  threshold: { min: -40, max: 80 },
  hysteresis: { min: 0, max: 2 },
} as const;

// Shared building blocks. In zod 4, z.number() already rejects NaN and Infinity.
const id = z.uuidv4();
const isoUtc = z.iso.datetime(); // rejects offsets, so every timestamp is UTC ("Z")
const bounded = z.number().min(-1e6).max(1e6);
const operator = z.string().min(1).max(40);

export const directionSchema = z.enum(["up", "down"]);

/** One value from the sensor. `t` is epoch milliseconds, which keeps the 10/s stream small. */
export const readingValueSchema = z.object({
  t: z.number().int().nonnegative(),
  value: bounded,
});

export const settingsValueSchema = z.object({
  threshold: z
    .number()
    .min(SETTINGS_LIMITS.threshold.min)
    .max(SETTINGS_LIMITS.threshold.max),
  hysteresis: z
    .number()
    .min(SETTINGS_LIMITS.hysteresis.min)
    .max(SETTINGS_LIMITS.hysteresis.max),
});

/** The settings as the relay stores them: who changed them last, and when. */
export const settingsRecordSchema = settingsValueSchema.extend({
  updatedBy: z.string().min(1).max(40).nullable(), // null: the sensor's defaults
  at: isoUtc,
});

export const sensorInfoSchema = z.object({
  sensorId: id,
  label: z.string().min(1).max(60),
  rateHz: z.number().positive().max(100),
});

export const alertSchema = z.object({
  id, // made by the sensor, used as the idempotency key
  sourceId: id, // the sensorId of the sensor that sent it
  sourceLabel: z.string().min(1).max(60),
  metric: z.string().min(1).max(40),
  unit: z.string().max(10),
  threshold: bounded,
  hysteresis: z.number().min(0).max(1e6),
  value: bounded,
  direction: directionSchema,
  eventTime: isoUtc, // when the reading was taken
});

export const alertRecordSchema = alertSchema.extend({
  receivedAt: isoUtc, // stamped by the server
  acknowledgement: z.object({ operator, at: isoUtc }).nullable(),
});

// Client -> server

export const helloSchema = z.object({
  type: z.literal("hello"),
  // Any positive integer parses, so the server can answer an unknown version
  // with UNSUPPORTED_VERSION instead of a generic BAD_MESSAGE.
  v: z.number().int().positive(),
  role: z.enum(["monitor", "control", "sensor"]),
  clientName: z.string().min(1).max(60),
  // Only for role "sensor": a service has no session cookie (ADR 0009).
  token: z.string().min(1).max(200).optional(),
  sensor: sensorInfoSchema.optional(),
});

/** Sensor -> relay: one reading. Not stored and not confirmed. */
export const sendReadingSchema = z.object({
  type: z.literal("reading"),
  reading: readingValueSchema,
});

/** Sensor -> relay: the settings it uses, when the relay has none stored. */
export const settingsAppliedSchema = z.object({
  type: z.literal("settingsApplied"),
  settings: settingsValueSchema,
});

/** Monitor -> relay: change the shared settings. */
export const setSettingsSchema = z.object({
  type: z.literal("setSettings"),
  settings: settingsValueSchema,
});

export const sendAlertSchema = z.object({
  type: z.literal("alert"),
  alert: alertSchema,
});

// No operator: the relay writes the signed-in user's name, so it cannot be forged.
export const ackAlertSchema = z.object({
  type: z.literal("ack"),
  alertId: id,
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  helloSchema,
  sendAlertSchema,
  ackAlertSchema,
  sendReadingSchema,
  settingsAppliedSchema,
  setSettingsSchema,
]);

// Server -> client

export const welcomeSchema = z.object({
  type: z.literal("welcome"),
  connectionId: id,
  recent: z.array(alertRecordSchema).max(WELCOME_RECENT_LIMIT), // newest first
  settings: settingsRecordSchema.nullable(), // null until the sensor reports
  sensor: sensorInfoSchema.nullable(), // null while no sensor is connected
  readings: z.array(readingValueSchema).max(WELCOME_READINGS_LIMIT), // oldest first; monitors only
});

/** Relay -> monitors: one reading from the sensor. */
export const readingMsgSchema = z.object({
  type: z.literal("reading"),
  reading: readingValueSchema,
});

/** Relay -> monitors and the sensor: the current shared settings. */
export const settingsMsgSchema = z.object({
  type: z.literal("settings"),
  settings: settingsRecordSchema,
});

/** Relay -> all: the sensor connected (info) or disconnected (null). */
export const sensorStatusSchema = z.object({
  type: z.literal("sensorStatus"),
  sensor: sensorInfoSchema.nullable(),
});

export const alertMsgSchema = z.object({
  type: z.literal("alert"),
  record: alertRecordSchema,
});

export const acceptedSchema = z.object({
  type: z.literal("accepted"),
  alertId: id,
  receivedAt: isoUtc,
  duplicate: z.boolean(),
});

export const acknowledgedSchema = z.object({
  type: z.literal("acknowledged"),
  alertId: id,
  operator,
  at: isoUtc,
});

export const errorCodeSchema = z.enum([
  "BAD_MESSAGE",
  "UNSUPPORTED_VERSION",
  "NOT_ALLOWED",
  "RATE_LIMITED",
  "UNKNOWN_ALERT",
  "HELLO_REQUIRED",
]);

export const errorMsgSchema = z.object({
  type: z.literal("error"),
  code: errorCodeSchema,
  message: z.string().max(500),
  ref: z.string().max(100).optional(),
});

export const serverMessageSchema = z.discriminatedUnion("type", [
  welcomeSchema,
  readingMsgSchema,
  settingsMsgSchema,
  sensorStatusSchema,
  alertMsgSchema,
  acceptedSchema,
  acknowledgedSchema,
  errorMsgSchema,
]);

export type Direction = z.infer<typeof directionSchema>;
export type ReadingValue = z.infer<typeof readingValueSchema>;
export type SettingsValue = z.infer<typeof settingsValueSchema>;
export type SettingsRecord = z.infer<typeof settingsRecordSchema>;
export type SensorInfo = z.infer<typeof sensorInfoSchema>;
export type Alert = z.infer<typeof alertSchema>;
export type AlertRecord = z.infer<typeof alertRecordSchema>;
export type Hello = z.infer<typeof helloSchema>;
export type SendAlert = z.infer<typeof sendAlertSchema>;
export type AckAlert = z.infer<typeof ackAlertSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type Welcome = z.infer<typeof welcomeSchema>;
export type AlertMsg = z.infer<typeof alertMsgSchema>;
export type Accepted = z.infer<typeof acceptedSchema>;
export type Acknowledged = z.infer<typeof acknowledgedSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ErrorMsg = z.infer<typeof errorMsgSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
