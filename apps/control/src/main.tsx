import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { ConnectRelay } from "./connection/useRelay";
import { createRelayConnection, relayUrl } from "./connection/relayConnection";
import "./styles.css";

// Composition root: long-lived objects are defined once, here, outside React.
const connect: ConnectRelay = (handlers) =>
  createRelayConnection(
    { url: relayUrl(window.location), clientName: "Control room" },
    handlers,
  );
const storage = () => window.localStorage;

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App connect={connect} storage={storage} />
  </StrictMode>,
);
