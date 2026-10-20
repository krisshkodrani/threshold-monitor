export type Side = "above" | "below" | null;
export interface Detector {
  side: Side;
}
export interface Crossing {
  direction: "up" | "down";
}
export interface SimulationConfig {
  threshold: number;
  hysteresis: number;
  readings: number[];
}
export interface Reading {
  t: number;
  value: number;
}
export interface Alert {
  id: string;
  sourceId: string;
  sourceLabel: string;
  metric: string;
  unit: string;
  value: number;
  direction: "up" | "down";
  threshold: number;
  hysteresis: number;
  eventTime: string;
}
export interface Acknowledgement {
  operator: string;
  at: string;
}
export interface AlertRecord extends Alert {
  receivedAt: string;
  acknowledgement: Acknowledgement | null;
}
export interface Sample extends Reading {
  number: number;
  event: Crossing | null;
  alert: Alert | null;
}
export interface SimulationState {
  config: SimulationConfig;
  scenario: string | null;
  settingsPhase: number;
  settingsChanged: boolean;
  reclassifyOnReading: boolean;
  started: boolean;
  index: number;
  phase: number;
  detector: Detector;
  previous: Side;
  current: Sample | null;
  samples: Sample[];
  pending: Alert[];
  relayReadings: Reading[];
  relayAlerts: AlertRecord[];
  monitorReadings: Reading[];
  monitorAlerts: AlertRecord[];
  controlAlerts: AlertRecord[];
  events: {
    number: number;
    time: string;
    sample: number;
    title: string;
    payload: unknown;
  }[];
  clock: number;
  alertCount: number;
  ack: {
    id: string;
    phase: number;
    record: AlertRecord | null;
  } | null;
  messageJourney: {
    kind: "reading" | "settings" | "ack";
    phase?: number;
    id?: string;
  } | null;
  active: "sensor" | "relay" | "views" | "monitor" | null;
  status: string;
  title: string;
  reason: string;
}
export type SimulationAction =
  | { type: "NEXT_STAGE" }
  | { type: "REQUEST_ACK"; id: string }
  | { type: "RESTART"; config: SimulationConfig; scenario?: string | null }
  | { type: "RESTORE"; state: SimulationState };

export interface SimulationMessage {
  id: string;
  from: string;
  to: string;
  name: string;
  preview: string;
  stage: number;
  transport: string;
  edge: string | null;
  payload: unknown;
  description: string;
  state: "pending" | "active" | "complete";
}
export interface SimulationMessageModel {
  rows: SimulationMessage[];
  stage: number;
  key: string;
  context: string;
  isAck: boolean;
  isSettings?: boolean;
}
