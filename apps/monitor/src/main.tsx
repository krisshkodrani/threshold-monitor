import {
  AccountBar,
  createRelayConnection,
  fetchAccount,
  loginUrl,
  logout,
  relayUrl,
  type ConnectRelay,
} from "@app/client";
import { ErrorBoundary } from "@app/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { App } from "./App";
import { windowSize } from "./config";
import { createReadingsStore } from "./data/readingsStore";
import { createAppStore } from "./store";
import "./styles.css";

const element = document.getElementById("root");
if (!element) throw new Error("Missing #root element");
const root = createRoot(element);

// The first paint, while the session check runs (a few milliseconds).
root.render(
  <main className="app">
    <h1>Threshold Monitor</h1>
    <p className="muted" role="status">
      Checking your session…
    </p>
  </main>,
);

/** Back to the login page, which returns here after login. */
const goToLogin = () =>
  window.location.assign(
    loginUrl(window.location.pathname + window.location.search),
  );
const signOut = () => void logout().finally(goToLogin);

// Composition root: long-lived objects are created once, here, outside React.
const connect: ConnectRelay = (handlers) =>
  createRelayConnection(
    {
      url: relayUrl(window.location),
      role: "monitor",
      clientName: "Monitor",
    },
    {
      ...handlers,
      onStatus(status) {
        handlers.onStatus(status);
        // The session ended (logout or expiry): log in again.
        if (status.kind === "signedOut") goToLogin();
      },
    },
  );

// The page needs a session with the monitor role before it connects.
fetchAccount().then(
  (account) => {
    if (!account) return goToLogin();
    if (!account.roles.includes("monitor"))
      return showMessage(
        "This account cannot use the monitor.",
        account.displayName,
      );
    root.render(
      <StrictMode>
        {/* The last line of defense: the panes have their own boundaries. */}
        <ErrorBoundary name="The monitor">
          <Provider store={createAppStore()}>
            <App
              connect={connect}
              readings={createReadingsStore(windowSize)}
              account={{ displayName: account.displayName, onLogout: signOut }}
            />
          </Provider>
        </ErrorBoundary>
      </StrictMode>,
    );
  },
  (err: unknown) =>
    showMessage(
      `Cannot reach the server. Reload the page to try again. (${String(err)})`,
    ),
);

function showMessage(message: string, displayName?: string) {
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
