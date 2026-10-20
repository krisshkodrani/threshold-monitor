import {
  chapterText,
  type ChapterLanguage,
} from "../../presentation/chapterLanguage";
import { simId, simTemperature } from "../format";
import type { AlertRecord, SimulationState } from "../types";
interface Props {
  language: ChapterLanguage;
  records: AlertRecord[];
  pending: SimulationState["ack"];
  operator?: boolean;
  onAcknowledge: (id: string) => void;
}
export function AlarmList({
  language,
  records,
  pending,
  operator = false,
  onAcknowledge,
}: Props) {
  const t = (text: string) => chapterText(text, language);
  if (records.length === 0)
    return (
      <p className="sim-empty">{t("No crossing alerts in this view yet.")}</p>
    );
  return [...records].reverse().map((record) => {
    const ack = record.acknowledgement,
      waiting = pending?.id === record.id;
    return (
      <div
        key={record.id}
        className={`sim-record ${ack ? "is-acknowledged" : waiting ? "is-ack-pending" : ""}`}
        data-record-id={record.id}
      >
        <span
          className="sim-record-symbol"
          aria-label={t(ack ? "Acknowledged" : `${record.direction} crossing`)}
        >
          {ack ? (
            <svg className="icon" aria-hidden="true">
              <use href="#i-check" />
            </svg>
          ) : record.direction === "up" ? (
            "▲"
          ) : (
            "▼"
          )}
        </span>
        <div>
          <strong>
            {simId(record.id)} · {simTemperature(record.value)}
          </strong>
          <small>
            {t(`${record.direction} crossing`)} ·{" "}
            {record.eventTime.slice(11, 19)}
          </small>
        </div>
        {operator ? (
          <button
            className="sim-ack"
            type="button"
            data-sim-ack={record.id}
            aria-label={`${t("Acknowledge alarm")} ${simId(record.id)}`}
            disabled={!!ack || !!pending}
            onClick={() => onAcknowledge(record.id)}
          >
            {t(
              ack
                ? "Acknowledged"
                : waiting
                  ? pending.phase === 1
                    ? "Sent · Step"
                    : pending.phase === 2
                      ? "Stored · Step"
                      : "Broadcast · Step"
                  : "Acknowledge",
            )}
          </button>
        ) : (
          <span className="sim-record-status">
            {t(ack ? "Acknowledged by Alex" : "Received")}
          </span>
        )}
        {operator && ack && (
          <small className="sim-record-status">{t("by Alex")}</small>
        )}
      </div>
    );
  });
}
