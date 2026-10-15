import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider } from "react-redux";
import { App } from "./App";
import { fetchAccount, loginUrl, logout } from "./auth";
import { AccountBar } from "./components/AccountBar";
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

const element = document.getElementById("root");
if (!element) throw new Error("Missing #root element");
const root = createRoot(element);

/** Back to the login page, which returns here (with ?rate and ?seed) after login. */
const goToLogin = () =>
  window.location.assign(
    loginUrl(window.location.pathname + window.location.search),
  );
const signOut = () => void logout().finally(goToLogin);

// The page needs a session with the monitor role before anything starts.
fetchAccount().then(
  (account) => {
    if (!account) return goToLogin();
    if (!account.roles.includes("monitor"))
      return showMessage(
        root,
        "This account cannot use the monitor.",
        account.displayName,
      );
    start(account.displayName);
  },
  (err: unknown) =>
    showMessage(
      root,
      `Cannot reach the server. Reload the page to try again. (${String(err)})`,
    ),
);

// Composition root: every long-lived object is created exactly once, here,
// outside React. None of them starts timers or connections on creation.
function start(displayName: string) {
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
  const createTransport = () => {
    const transport = createWebSocketTransport({
      url: relayUrl(window.location),
      identity,
    });
    // The session ended (logout or expiry): log in again.
    transport.onStatus((status) => {
      if (status.kind === "signedOut") goToLogin();
    });
    return transport;
  };

  root.render(
    <StrictMode>
      <Provider store={store}>
        <App
          source={source}
          readings={readings}
          createTransport={createTransport}
          identity={identity}
          initialRateHz={launch.rateHz}
          account={{ displayName, onLogout: signOut }}
        />
      </Provider>
    </StrictMode>,
  );
}

function showMessage(root: Root, message: string, displayName?: string) {
  root.render(
    <StrictMode>
      <main className="app">
        <h1>Threshold Monitor</h1>
        <p role="alert">{message}</p>
        {displayName && (
          <AccountBar displayName={displayName} onLogout={signOut} />
        )}
      </main>
    </StrictMode>,
  );
}
