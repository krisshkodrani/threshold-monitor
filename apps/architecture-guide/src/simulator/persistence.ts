import { newSimulation } from "./model";
import type { SimulationState } from "./types";

export const SESSION_KEY = "threshold-guide-simulator-v1";
export interface SavedSession {
  version: 1;
  simulation: SimulationState;
  inputs: { threshold: string; hysteresis: string; sequence: string };
  view: string;
}
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const integer = (v: unknown): v is number =>
  finite(v) && Number.isInteger(v) && v >= 0;
const side = (v: unknown) => v === null || v === "above" || v === "below";
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 10000;
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const list = (v: unknown, check: (item: unknown) => boolean, max = 100) =>
  Array.isArray(v) && v.length <= max && v.every(check);
const reading = (v: unknown) => object(v) && finite(v.t) && finite(v.value);
const acknowledgement = (v: unknown) =>
  v === null || (object(v) && text(v.operator) && date(v.at));
const alert = (v: unknown) =>
  object(v) &&
  text(v.id) &&
  /^[a-f\d-]{36}$/i.test(v.id) &&
  text(v.sourceId) &&
  text(v.sourceLabel) &&
  text(v.metric) &&
  text(v.unit) &&
  finite(v.value) &&
  finite(v.threshold) &&
  finite(v.hysteresis) &&
  (v.direction === "up" || v.direction === "down") &&
  date(v.eventTime);
const record = (v: unknown) =>
  alert(v) &&
  object(v) &&
  date(v.receivedAt) &&
  acknowledgement(v.acknowledgement);
const sample = (v: unknown) =>
  reading(v) &&
  object(v) &&
  integer(v.number) &&
  v.number > 0 &&
  (v.event === null ||
    (object(v.event) && ["up", "down"].includes(String(v.event.direction)))) &&
  (v.alert === null || alert(v.alert));

export function parseSession(raw: string | null): SavedSession | null {
  try {
    if (!raw || raw.length > 2_000_000) return null;
    const saved: unknown = JSON.parse(raw);
    if (
      !object(saved) ||
      saved.version !== 1 ||
      !object(saved.simulation) ||
      !object(saved.inputs)
    )
      return null;
    const s = saved.simulation,
      cfg = s.config;
    if (
      !object(cfg) ||
      !finite(cfg.threshold) ||
      cfg.threshold < -40 ||
      cfg.threshold > 80 ||
      !finite(cfg.hysteresis) ||
      cfg.hysteresis < 0 ||
      cfg.hysteresis > 2 ||
      !list(cfg.readings, (v) => finite(v) && Math.abs(v) <= 1e6) ||
      !Array.isArray(cfg.readings) ||
      cfg.readings.length === 0
    )
      return null;
    if (
      !integer(s.index) ||
      s.index > cfg.readings.length ||
      ![0, 1, 2].includes(Number(s.phase)) ||
      !integer(s.phase) ||
      !finite(s.clock) ||
      !date(new Date(s.clock).toISOString()) ||
      !object(s.detector) ||
      !side(s.detector.side) ||
      !side(s.previous)
    )
      return null;
    if (
      !list(s.samples, sample) ||
      !list(s.pending, alert) ||
      !list(s.relayReadings, reading) ||
      !list(s.monitorReadings, reading) ||
      !list(s.relayAlerts, record) ||
      !list(s.monitorAlerts, record) ||
      !list(s.controlAlerts, record)
    )
      return null;
    if (
      !Array.isArray(s.samples) ||
      s.samples.length !== s.index + (s.phase > 0 ? 1 : 0) ||
      (s.current !== null && !sample(s.current)) ||
      (s.samples.length > 0 && !object(s.current))
    )
      return null;
    if (
      !list(
        s.events,
        (v) =>
          object(v) &&
          integer(v.number) &&
          integer(v.sample) &&
          text(v.title) &&
          date(v.time) &&
          object(v.payload),
        5000,
      )
    )
      return null;
    if (
      !["started", "settingsChanged", "reclassifyOnReading"].every(
        (key) => typeof s[key] === "boolean",
      ) ||
      !integer(s.alertCount) ||
      !integer(s.settingsPhase) ||
      s.settingsPhase > 3 ||
      !["status", "title", "reason"].every((key) => text(s[key]))
    )
      return null;
    if (
      !(s.scenario === null || text(s.scenario)) ||
      ![null, "sensor", "relay", "views", "monitor"].includes(s.active as null)
    )
      return null;
    if (
      s.messageJourney !== null &&
      (!object(s.messageJourney) ||
        !["reading", "settings", "ack"].includes(String(s.messageJourney.kind)))
    )
      return null;
    if (s.ack !== null) {
      const ack = s.ack;
      if (
        !object(ack) ||
        !text(ack.id) ||
        !integer(ack.phase) ||
        ![1, 2, 3].includes(ack.phase) ||
        !Array.isArray(s.relayAlerts) ||
        !s.relayAlerts.some((r: unknown) => object(r) && r.id === ack.id) ||
        !object(s.messageJourney) ||
        s.messageJourney.kind !== "ack" ||
        s.messageJourney.id !== ack.id ||
        (ack.phase !== 1 &&
          (!record(ack.record) ||
            !object(ack.record) ||
            ack.record.acknowledgement === null))
      )
        return null;
      delete ack.resumePlayback; // Discard legacy automatic-playback intent.
    }
    if (
      !["threshold", "hysteresis", "sequence"].every((key) =>
        text((saved.inputs as ObjectValue)[key]),
      ) ||
      !["chart", "map", "control"].includes(String(saved.view))
    )
      return null;
    // Earlier exports combined broadcasting and browser application in stage 3.
    if (
      s.ack === null &&
      object(s.messageJourney) &&
      s.messageJourney.kind === "ack" &&
      s.messageJourney.phase === 3
    )
      s.messageJourney.phase = 4;
    // The checks above establish the complete version-1 shape before crossing the boundary.
    const session = saved as unknown as SavedSession;
    session.simulation = {
      ...newSimulation(session.simulation.config),
      ...session.simulation,
    };
    if (!session.simulation.started)
      session.simulation.reason = newSimulation(
        session.simulation.config,
      ).reason;
    return session;
  } catch {
    return null;
  }
}
export function loadSession(): SavedSession | null {
  try {
    return parseSession(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}
export function saveSession(session: SavedSession): boolean {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}
