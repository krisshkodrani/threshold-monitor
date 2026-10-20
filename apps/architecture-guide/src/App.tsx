import {
  memo,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { ProjectNavigation } from "@app/ui";
import { createPortal } from "react-dom";
import { flushSync } from "react-dom";
import type { ChapterLanguage } from "./presentation/chapterLanguage";
import { SimulatorViews } from "./simulator/components/SimulatorViews";
import { guideDocument } from "./content/document";
import { mountGuide } from "./presentation/mountGuide";
import { newSimulation, simulationPresets } from "./simulator/model";
import { loadSession } from "./simulator/persistence";
import { simulationReducer } from "./simulator/reducer";
import type { SimulationAction } from "./simulator/types";

// Static prose and authored SVG retain their existing DOM while the reducer updates.
// The presentation adapter owns descendants; React owns its lifecycle and domain state.
const GuideDocument = memo(function GuideDocument({
  onReady,
}: {
  onReady: (targets: HTMLElement[]) => void;
}) {
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      if (node)
        onReady(
          [
            "sim-relay-records",
            "sim-monitor-records",
            "sim-control-records",
          ].map((id) => node.querySelector<HTMLElement>("#" + id)!),
        );
    },
    [onReady],
  );
  return (
    <div ref={attach} dangerouslySetInnerHTML={{ __html: guideDocument }} />
  );
});
export function App() {
  const [session] = useState(loadSession);
  const [language, setLanguage] = useState<ChapterLanguage>("en");
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  const [state, dispatch] = useReducer(
    simulationReducer,
    session,
    (saved) =>
      saved?.simulation ??
      newSimulation(structuredClone(simulationPresets.crossings!)),
  );
  const adapter = useRef<ReturnType<typeof mountGuide> | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
    adapter.current?.update(state);
  }, [state]);
  useEffect(() => {
    adapter.current = mountGuide({
      getState: () => stateRef.current,
      onLanguageChange: setLanguage,
      dispatch: (action: SimulationAction) => {
        // Presentation commands such as "next reading" can dispatch several stages
        // in one DOM event. Each command must observe the committed prior stage.
        flushSync(() => dispatch(action));
      },
      restored: session !== null,
      session,
    });
    return () => {
      adapter.current?.dispose();
      adapter.current = null;
    };
  }, [session]);
  return (
    <>
      <GuideDocument onReady={setTargets} />
      {targets.length > 0 &&
        createPortal(
          <ProjectNavigation current="architecture" language={language} />,
          document.getElementById("project-navigation-target")!,
        )}
      <SimulatorViews
        language={language}
        targets={targets}
        state={state}
        onAcknowledge={(id) => adapter.current?.acknowledge(id)}
      />
    </>
  );
}
