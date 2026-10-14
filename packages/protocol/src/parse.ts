import type { z } from "zod";
import {
  clientMessageSchema,
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from "./messages";

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type ProtocolError = {
  reason: "invalid_json" | "invalid_message";
  /** Short, human readable summary. Safe to send back to a client. */
  message: string;
};

// Socket input is untrusted, so parsing never throws: callers branch on the result.
function parseWith<T>(
  schema: z.ZodType<T>,
  raw: string,
): Result<T, ProtocolError> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: { reason: "invalid_json", message: "Message is not valid JSON." },
    };
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        reason: "invalid_message",
        message: summarizeIssues(parsed.error),
      },
    };
  }
  return { ok: true, value: parsed.data };
}

// A few "path: message" pairs are enough to debug, without echoing the payload back.
function summarizeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export function parseClientMessage(
  raw: string,
): Result<ClientMessage, ProtocolError> {
  return parseWith(clientMessageSchema, raw);
}

export function parseServerMessage(
  raw: string,
): Result<ServerMessage, ProtocolError> {
  return parseWith(serverMessageSchema, raw);
}

/** Typed serialization: the compiler rejects anything that is not a protocol message. */
export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}
