import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { App } from "./App";
import { defaults } from "./config";
import { createRandomWalkSource } from "./data/randomWalkSource";
import { createReadingsStore } from "./data/readingsStore";
import { getSourceIdentity } from "./identity";
import { readLaunchOptions } from "./launchOptions";
import { createAppStore } from "./store";
import { loadSettings, persistSettings } from "./store/persistence";
import {
  createWebSocketTransport,
  relayUrl,
} from "./transport/websocketTransport";
import "./styles.css";

// Composition root: every long-lived object is created exactly once, here,
// outside React. None of them starts timers or connections on creation.
const launch = readLaunchOptions(window.location.search);
const local = () => window.localStorage;
const session = () => window.sessionStorage;

const store = createAppStore({ threshold: loadSettings(local) });
persistSettings(store, local);

const source = createRandomWalkSource({
  seed: launch.seed,
  rateHz: launch.rateHz,
});
const readings = createReadingsStore(defaults.windowSize);
const identity = getSourceIdentity(session);
// inMemoryTransport.ts remains as a server-free alternative (M7 decides if it stays).
const createTransport = () =>
  createWebSocketTransport({ url: relayUrl(window.location), identity });

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <Provider store={store}>
      <App
        source={source}
        readings={readings}
        createTransport={createTransport}
        identity={identity}
        initialRateHz={launch.rateHz}
      />
    </Provider>
  </StrictMode>,
);
