import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { fetchAccount, loginUrl, logout } from "./auth";
import { AccountBar } from "./components/AccountBar";
import type { ConnectRelay } from "./connection/useRelay";
import { createRelayConnection, relayUrl } from "./connection/relayConnection";
import "./styles.css";

const element = document.getElementById("root");
if (!element) throw new Error("Missing #root element");
const root = createRoot(element);

/** Back to the login page, which returns to the control room after login. */
const goToLogin = () =>
  window.location.assign(loginUrl(window.location.pathname));
const signOut = () => void logout().finally(goToLogin);

// Composition root: long-lived objects are defined once, here, outside React.
const connect: ConnectRelay = (handlers) =>
  createRelayConnection(
    { url: relayUrl(window.location), clientName: "Control room" },
    {
      ...handlers,
      onStatus(status) {
        handlers.onStatus(status);
        // The session ended (logout or expiry): log in again.
        if (status.kind === "signedOut") goToLogin();
      },
    },
  );

// The page needs a session with the operator role before it connects.
fetchAccount().then(
  (account) => {
    if (!account) return goToLogin();
    if (!account.roles.includes("operator"))
      return showMessage(
        "This account cannot use the control room.",
        account.displayName,
      );
    root.render(
      <StrictMode>
        <App
          connect={connect}
          account={{ displayName: account.displayName, onLogout: signOut }}
        />
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
        <h1>Control Room</h1>
        <p role="alert">{message}</p>
        {displayName && (
          <AccountBar displayName={displayName} onLogout={signOut} />
        )}
      </main>
    </StrictMode>,
  );
}
