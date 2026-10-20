import { createPortal } from "react-dom";
import type { SimulationState } from "../types";
import type { ChapterLanguage } from "../../presentation/chapterLanguage";
import { AlarmList } from "./AlarmList";
interface Props {
  language: ChapterLanguage;
  targets: HTMLElement[];
  state: SimulationState;
  onAcknowledge: (id: string) => void;
}
export function SimulatorViews({
  targets,
  state,
  onAcknowledge,
  language,
}: Props) {
  const records = [state.relayAlerts, state.monitorAlerts, state.controlAlerts];
  return targets.map((target, i) =>
    createPortal(
      <AlarmList
        language={language}
        records={records[i]!}
        pending={state.ack}
        operator={i === 2}
        onAcknowledge={onAcknowledge}
      />,
      target,
      target.id,
    ),
  );
}
