import { simulationSettingsChanges } from "../simulator/model";
import {
  mountChapterLanguage,
  chapterTitles,
  chapterText,
} from "./chapterLanguage";
import { sourceHref } from "../content/sourceHref";
import { mountCodeExplorer } from "./codeExplorer";
import { simulationPresets } from "../simulator/model";
import { simNumber, simTemperature, simId } from "../simulator/format";
import { simulationFinished as isFinished } from "../simulator/reducer";
import { simulationMessageModel } from "../simulator/messages";
import { saveSession } from "../simulator/persistence";
import { nodes } from "../content/nodes";
import { simulationCaseDefinitions } from "../content/cases";
export function mountGuide(controller) {
  const listeners = [];
  let guideLanguage = "en";
  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }

  const $ = (s, root = document) => root.querySelector(s),
    $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const escapeHTML = (text) =>
    String(text).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const icon = (name) =>
    `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  function sourceLinks(files) {
    return files
      .map(
        (f) =>
          `<a class="file-link" href="${sourceHref(f)}" target="_blank" rel="noopener">${icon("code")}<span>${escapeHTML(f)} ↗</span></a>`,
      )
      .join("");
  }
  function selectNode(id) {
    const n = nodes[id];
    $$("[data-node]").forEach((el) => {
      const selected = el.dataset.node === id;
      el.classList.toggle("selected", selected);
      el.setAttribute("aria-pressed", selected);
    });
    $("#node-inspector").innerHTML =
      `<div><span class="eyebrow">${n.eyebrow}</span><h3>${n.label}</h3><p>${n.description}</p></div><div><span class="small-label">Key source files</span><div class="file-links">${sourceLinks(n.files)}</div></div><div><span class="small-label">Contracts & concepts</span><div class="tag-list">${n.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div><button class="text-button inspector-code-link" data-open-code="${n.code}">Explore implementation ${icon("arrow")}</button></div>`;
  }
  $$("[data-node]").forEach((el) => {
    listen(el, "click", () => selectNode(el.dataset.node));
    listen(el, "keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectNode(el.dataset.node);
      }
    });
  });
  selectNode("relay");
  const { selectCode, dispose: disposeCode } = mountCodeExplorer({
    $,
    $$,
    listen,
    navigate,
    t: (text) => chapterText(text, guideLanguage),
  });
  let simulation = controller.getState();
  function send(action) {
    controller.dispatch(action);
    simulation = controller.getState();
    saveSimulationSession();
  }
  function readSimulationConfig() {
    const thresholdText = $("#sim-threshold").value.trim(),
      hysteresisText = $("#sim-hysteresis").value.trim();
    const threshold = Number(thresholdText),
      hysteresis = Number(hysteresisText);
    const sequence = $("#sim-sequence").value.trim();
    const tokens = sequence ? sequence.split(/[,\s]+/).filter(Boolean) : [];
    const numericToken = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
    const readings = tokens.map(Number);
    const errors = [];
    const badThreshold =
      !thresholdText ||
      !Number.isFinite(threshold) ||
      threshold < -40 ||
      threshold > 80;
    const badHysteresis =
      !hysteresisText ||
      !Number.isFinite(hysteresis) ||
      hysteresis < 0 ||
      hysteresis > 2;
    const badSequence =
      !tokens.length ||
      tokens.length > 100 ||
      tokens.some(
        (t, i) =>
          !numericToken.test(t) ||
          !Number.isFinite(readings[i]) ||
          Math.abs(readings[i]) > 1e6,
      );
    if (badThreshold) errors.push("Threshold must be between −40 and 80°C.");
    if (badHysteresis) errors.push("Hysteresis must be between 0 and 2°C.");
    if (badSequence)
      errors.push(
        "Enter 1–100 finite readings between −1,000,000 and 1,000,000 using decimal points.",
      );
    for (const [id, bad] of [
      ["sim-threshold", badThreshold],
      ["sim-hysteresis", badHysteresis],
      ["sim-sequence", badSequence],
    ]) {
      $("#" + id).setAttribute("aria-invalid", String(bad));
      if (bad)
        $("#" + id).setAttribute(
          "aria-describedby",
          "sim-input-error" + (id === "sim-sequence" ? " sim-input-hint" : ""),
        );
      else if (id !== "sim-sequence")
        $("#" + id).removeAttribute("aria-describedby");
    }
    $("#sim-input-error").textContent = errors.join(" ");
    $("#sim-input-error").hidden = errors.length === 0;
    return errors.length ? null : { threshold, hysteresis, readings };
  }
  function simulationFinished() {
    return isFinished(simulation);
  }
  function advanceSimulation() {
    if (simulationFinished()) return;
    if (!simulation.started && !readSimulationConfig()) return;
    send({ type: "NEXT_STAGE" });
  }
  function requestSimulationAck(id) {
    send({ type: "REQUEST_ACK", id });
  }
  // Project each simulation stage into a selectable explanation trace.
  // Local detector/storage steps are deliberately separate from protocol messages.
  let simulationMessageRows = [];
  let selectedSimulationMessage = null;
  let simulationMessageKey = "";
  const simulationParticipants = {
    sensor: {
      label: "Sensor",
      path: "sensor/",
      icon: "pulse",
      x: 25,
      y: 165,
      width: 142,
      height: 91,
    },
    relay: {
      label: "Relay",
      path: "server/",
      icon: "server",
      x: 242,
      y: 165,
      width: 145,
      height: 91,
    },
    database: {
      label: "SQLite",
      path: "local storage",
      icon: "database",
      x: 242,
      y: 330,
      width: 145,
      height: 72,
    },
    monitor: {
      label: "Live Monitor",
      path: "apps/monitor/",
      icon: "monitor",
      x: 460,
      y: 57,
      width: 142,
      height: 91,
    },
    control: {
      label: "Control Room",
      path: "apps/control/",
      icon: "check",
      x: 460,
      y: 278,
      width: 142,
      height: 91,
    },
  };
  // Inspect the exact payload on a map connection without opening the full drawer.
  let simulationTooltipRoute = null,
    simulationTooltipRow = null,
    simulationTooltipPinned = false,
    simulationTooltipCloseTimer = null;
  function closeSimulationMessageTooltip(restoreFocus = false) {
    clearTimeout(simulationTooltipCloseTimer);
    const previous = simulationTooltipRoute;
    $("#sim-message-tooltip").hidden = true;
    simulationTooltipRoute = null;
    simulationTooltipRow = null;
    simulationTooltipPinned = false;
    $$("[data-sim-inspect-route]").forEach((trigger) => {
      trigger.setAttribute("aria-expanded", "false");
      trigger.classList.remove("is-inspected");
    });
    if (restoreFocus && previous) {
      const trigger = $(`[data-sim-inspect-route="${previous}"]`);
      trigger?.focus({ preventScroll: true });
    }
  }
  function positionSimulationMessageTooltip() {
    const popup = $("#sim-message-tooltip"),
      trigger = $(`[data-sim-inspect-route="${simulationTooltipRoute}"]`);
    if (!trigger || popup.hidden) return;
    const rect = trigger.getBoundingClientRect(),
      width = popup.offsetWidth,
      height = popup.offsetHeight;
    let left = rect.right + 12;
    if (left + width > innerWidth - 12) left = rect.left - width - 12;
    popup.style.left =
      Math.max(12, Math.min(left, innerWidth - width - 12)) + "px";
    let top = rect.top - 10;
    if (innerWidth <= 760) {
      top =
        innerHeight - rect.bottom - 12 >= height
          ? rect.bottom + 12
          : rect.top - 12 >= height + 58
            ? rect.top - height - 12
            : innerHeight - height - 12;
    }
    popup.style.top =
      Math.max(58, Math.min(top, innerHeight - height - 12)) + "px";
  }
  function selectSimulationTooltipMessage(id) {
    const rows = simulationMessageRows.filter(
      (row) => row.edge === simulationTooltipRoute,
    );
    const row = rows.find((row) => row.id === id);
    simulationTooltipRow = row?.id ?? null;
    $("#sim-tooltip-messages").innerHTML = rows
      .map(
        (item) =>
          `<button type="button" data-tooltip-message="${item.id}" aria-pressed="${item === row}">${escapeHTML(item.name)}</button>`,
      )
      .join("");
    $("#sim-tooltip-meta").textContent = row
      ? `${row.transport} · ${row.state === "pending" ? "Not reached yet" : row.state === "active" ? "Current stage" : "Earlier in this reading"}`
      : "No message on this route in the current journey";
    $("#sim-tooltip-description").textContent = row
      ? row.description
      : "This connection is available, but no message has been sent on it in this journey. Advance the sequence or acknowledge an alarm to inspect its payload.";
    $("#sim-tooltip-json").textContent = row?.payload
      ? JSON.stringify(row.payload, null, 2)
      : "No payload yet. This step has not sent a message.";
    positionSimulationMessageTooltip();
  }
  function openSimulationMessageTooltip(route, pin = false) {
    clearTimeout(simulationTooltipCloseTimer);
    if (simulationTooltipPinned && simulationTooltipRoute !== route && !pin)
      return;
    const trigger = $(`[data-sim-inspect-route="${route}"]`);
    if (!trigger) return;
    if (pin) simulationTooltipPinned = true;
    simulationTooltipRoute = route;
    $$("[data-sim-inspect-route]").forEach((item) => {
      const selected = item === trigger;
      item.setAttribute("aria-expanded", String(selected));
      item.classList.toggle("is-inspected", selected);
    });
    const [from, to] = route.split("-");
    $("#sim-tooltip-title").textContent =
      simulationParticipants[from].label +
      " → " +
      simulationParticipants[to].label;
    const rows = simulationMessageRows.filter((row) => row.edge === route);
    const row =
      rows.find((item) => item.id === simulationTooltipRow) ??
      rows.filter((item) => item.state === "active" && item.payload).at(-1) ??
      rows.filter((item) => item.payload).at(-1) ??
      rows[0];
    $("#sim-message-tooltip").hidden = false;
    selectSimulationTooltipMessage(row?.id);
  }
  function scheduleSimulationTooltipClose() {
    clearTimeout(simulationTooltipCloseTimer);
    if (!simulationTooltipPinned)
      simulationTooltipCloseTimer = setTimeout(
        () => closeSimulationMessageTooltip(),
        180,
      );
  }
  let simulationTooltipPointerDown = false;
  listen($("#sim-message-svg"), "pointerdown", () => {
    simulationTooltipPointerDown = true;
  });
  listen(window, "pointerup", () => {
    setTimeout(() => {
      simulationTooltipPointerDown = false;
    }, 0);
  });
  $("#sim-message-svg").setAttribute("role", "group");
  listen($("#sim-message-svg"), "pointerover", (event) => {
    const trigger = event.target.closest("[data-sim-inspect-route]");
    if (
      trigger &&
      !trigger.contains(event.relatedTarget) &&
      innerWidth > 760 &&
      matchMedia("(hover: hover)").matches
    )
      openSimulationMessageTooltip(trigger.dataset.simInspectRoute);
  });
  listen($("#sim-message-svg"), "pointerout", (event) => {
    const trigger = event.target.closest("[data-sim-inspect-route]");
    if (trigger && !trigger.contains(event.relatedTarget))
      scheduleSimulationTooltipClose();
  });
  listen($("#sim-message-svg"), "focusin", (event) => {
    const trigger = event.target.closest("[data-sim-inspect-route]");
    if (trigger && !simulationTooltipPointerDown) {
      openSimulationMessageTooltip(trigger.dataset.simInspectRoute);
    }
  });
  listen($("#sim-message-svg"), "focusout", (event) => {
    if (!$("#sim-message-tooltip").contains(event.relatedTarget))
      scheduleSimulationTooltipClose();
  });
  listen($("#sim-message-svg"), "click", (event) => {
    const trigger = event.target.closest("[data-sim-inspect-route]");
    if (trigger)
      openSimulationMessageTooltip(trigger.dataset.simInspectRoute, true);
  });
  listen($("#sim-message-svg"), "keydown", (event) => {
    const trigger = event.target.closest("[data-sim-inspect-route]");
    if (trigger && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openSimulationMessageTooltip(trigger.dataset.simInspectRoute, true);
      $("#sim-tooltip-json").focus({ preventScroll: true });
    }
  });
  listen($("#sim-message-tooltip"), "pointerenter", () =>
    clearTimeout(simulationTooltipCloseTimer),
  );
  listen(
    $("#sim-message-tooltip"),
    "pointerleave",
    scheduleSimulationTooltipClose,
  );
  listen($("#sim-message-tooltip"), "focusin", () =>
    clearTimeout(simulationTooltipCloseTimer),
  );
  listen($("#sim-tooltip-messages"), "click", (event) => {
    const button = event.target.closest("[data-tooltip-message]");
    if (button) {
      simulationTooltipPinned = true;
      selectSimulationTooltipMessage(button.dataset.tooltipMessage);
      $('#sim-tooltip-messages [aria-pressed="true"]')?.focus({
        preventScroll: true,
      });
    }
  });
  listen($("#sim-tooltip-close"), "click", () => {
    const route = simulationTooltipRoute;
    closeSimulationMessageTooltip();
    const trigger = $(`[data-sim-inspect-route="${route}"]`);
    if (trigger) trigger.focus({ preventScroll: true });
    closeSimulationMessageTooltip();
  });
  listen(document, "pointerdown", (event) => {
    if (!event.target.closest("#sim-message-tooltip,[data-sim-inspect-route]"))
      closeSimulationMessageTooltip();
  });
  listen(
    document,
    "keydown",
    (event) => {
      if (event.key === "Escape" && !$("#sim-message-tooltip").hidden) {
        event.preventDefault();
        event.stopPropagation();
        const route = simulationTooltipRoute;
        closeSimulationMessageTooltip();
        $(`[data-sim-inspect-route="${route}"]`)?.focus({
          preventScroll: true,
        });
        closeSimulationMessageTooltip();
      }
    },
    true,
  );
  listen(window, "resize", () => closeSimulationMessageTooltip());
  listen(window, "scroll", () => closeSimulationMessageTooltip(), {
    passive: true,
  });
  listen(window, "beforeprint", () => closeSimulationMessageTooltip());

  function renderSimulationArchitecture(row) {
    const participants = simulationParticipants;
    const routes = [
      {
        id: "monitor-relay",
        from: "monitor",
        to: "relay",
        path: "M460 130H441V210H387",
        x: 420,
        y: 155,
        label: "setSettings",
      },
      {
        id: "sensor-relay",
        from: "sensor",
        to: "relay",
        path: "M167 195H242",
        x: 203,
        y: 183,
        label: "reading · alert",
      },
      {
        id: "relay-sensor",
        from: "relay",
        to: "sensor",
        path: "M242 235H167",
        x: 203,
        y: 254,
        label: "accepted / ack",
      },
      {
        id: "relay-monitor",
        from: "relay",
        to: "monitor",
        path: "M387 187H421V95H460",
        x: 420,
        y: 72,
        label: "reading · alert",
      },
      {
        id: "relay-control",
        from: "relay",
        to: "control",
        path: "M387 230H421V307H460",
        x: 420,
        y: 270,
        label: "alert",
      },
      {
        id: "control-relay",
        from: "control",
        to: "relay",
        path: "M460 349H404V249H387",
        x: 430,
        y: 369,
        label: "ack",
      },
      {
        id: "relay-database",
        from: "relay",
        to: "database",
        path: "M314 256V330",
        x: 363,
        y: 298,
        label: "INSERT / UPDATE",
        local: true,
      },
    ];
    let content = `<defs><marker id="sim-edge-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto-start-reverse"><path d="M1 1 6 3.5 1 6" fill="none" stroke="#91a69b" stroke-width="1.2"/></marker><marker id="sim-edge-active" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto-start-reverse"><path d="M1 1 6 3.5 1 6" fill="none" stroke="#26704d" stroke-width="1.4"/></marker></defs>`;
    for (const route of routes) {
      const selected = route.id === row.edge;
      const currentMessages = simulationMessageRows.filter(
        (message) => message.state === "active" && message.edge === route.id,
      );
      const active = currentMessages.length > 0;
      const completed = simulationMessageRows.some(
        (message) => message.state === "complete" && message.edge === route.id,
      );
      const emphasized = selected || active;
      const routeState = active
        ? "current"
        : completed
          ? "complete"
          : "pending";
      const actualLabel = selected
        ? row.name
        : active
          ? [...new Set(currentMessages.map((message) => message.name))].join(
              " · ",
            )
          : route.label;
      content += `<g class="sim-inspectable-route" data-sim-inspect-route="${route.id}" tabindex="0" role="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="sim-message-tooltip" aria-label="Inspect ${participants[route.from].label} to ${participants[route.to].label} messages"><path class="sim-route-hit" d="${route.path}"/><path class="sim-route-path ${route.local ? "storage" : ""} ${completed ? "completed" : ""} ${emphasized ? "selected" : ""}" data-route-state="${routeState}" data-sim-route="${route.id}" d="${route.path}" marker-end="url(#${emphasized ? "sim-edge-active" : "sim-edge-arrow"})"/><text class="sim-route-label ${emphasized ? "selected" : ""}" x="${route.x}" y="${route.y}" text-anchor="middle">${escapeHTML(actualLabel)}</text>`;
      content += "</g>";
    }
    for (const [id, p] of Object.entries(participants)) {
      const selected = id === row.from || id === row.to;
      content += `<g class="sim-map-node ${selected ? "selected" : ""}" data-sim-participant="${id}"><rect class="node-bg" x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="10"/><rect class="node-icon-bg" x="${p.x + 12}" y="${p.y + 12}" width="26" height="26" rx="7"/><svg class="icon" x="${p.x + 17}" y="${p.y + 17}" width="16" height="16"><use href="#i-${p.icon}"/></svg><text class="node-title" x="${p.x + 46}" y="${p.y + 29}">${p.label}</text><text class="node-meta" x="${p.x + 13}" y="${p.y + 57}">${p.path}</text>${id === "sensor" ? `<text class="node-meta" x="${p.x + 13}" y="${p.y + 75}">${simulation.current ? escapeHTML(simTemperature(simulation.current.value)) : "Read → detect"}</text>` : ""}${id === "relay" ? `<text class="node-meta" x="${p.x + 13}" y="${p.y + 75}">Validate · route</text>` : ""}</g>`;
    }
    content +=
      '<text class="sim-map-stage-caption" x="25" y="37">SENSOR SERVICE</text><text class="sim-map-stage-caption" x="242" y="37">RELAY + STORAGE</text><text class="sim-map-stage-caption" x="460" y="37">BROWSER APPS</text>';
    if (!row.edge)
      content += `<text class="sim-map-stage-caption" x="25" y="417">Selected: local operation inside ${participants[row.from].label}</text>`;
    $("#sim-message-svg").innerHTML = content;
    $("#sim-message-svg").setAttribute(
      "aria-label",
      `${row.name}: ${row.from === row.to ? "inside " + participants[row.from].label : participants[row.from].label + " to " + participants[row.to].label}. ${row.transport}. ${row.state === "pending" ? "Not reached yet." : "Payload available below."}`,
    );
  }
  function selectSimulationMessage(id) {
    const row = simulationMessageRows.find((row) => row.id === id);
    if (!row) return;
    selectedSimulationMessage = id;
    $$("[data-sim-message]").forEach((button) => {
      const selected = button.dataset.simMessage === id;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const from = simulationParticipants[row.from].label,
      to = simulationParticipants[row.to].label;
    const status =
      row.state === "pending"
        ? "Not reached yet"
        : row.state === "active"
          ? "Current manual stage"
          : "Earlier in this journey";
    $("#sim-payload-status").textContent = status;
    $("#sim-payload-title").textContent = row.name;
    $("#sim-payload-route").textContent =
      from === to ? "Inside " + from : `${from} → ${to}`;
    $("#sim-payload-description").textContent = row.description;
    $("#sim-payload-transport").textContent = row.transport;
    $("#sim-payload-json").textContent = row.payload
      ? JSON.stringify(row.payload, null, 2)
      : "Not reached yet. Advance the simulation to see the actual payload for this step.";
    $("#sim-map-selection").textContent =
      from === to ? `${from} · ${row.name}` : `${from} → ${to} · ${row.name}`;
    renderSimulationArchitecture(row);
  }
  function renderSimulationMessages() {
    closeSimulationMessageTooltip();
    const model = simulationMessageModel(simulation);
    simulationMessageRows = model.rows;
    const changed = model.key !== simulationMessageKey;
    simulationMessageKey = model.key;
    if (
      changed ||
      !simulationMessageRows.some((row) => row.id === selectedSimulationMessage)
    ) {
      const candidates = model.rows.filter((row) => row.stage === model.stage);
      selectedSimulationMessage =
        (model.stage === 1 && !model.isAck
          ? (candidates.find((row) => row.id === "build-alert") ??
            candidates.find((row) => row.id === "detect"))
          : (candidates
              .filter((candidate) =>
                candidate.transport.startsWith("WebSocket"),
              )
              .at(-1) ?? candidates.at(-1))
        )?.id ?? model.rows[0].id;
    }
    $("#sim-message-context").textContent = model.context;
    $("#sim-trace-count").textContent =
      `${model.rows.filter((row) => row.state !== "pending").length} / ${model.rows.length} REACHED`;
    const stageNames = model.isSettings
      ? [
          "1 · Monitor requests",
          "2 · Relay stores + sends",
          "3 · Sensor receives",
        ]
      : model.isAck
        ? [
            "1 · Operator request",
            "2 · Relay stores",
            "3 · Broadcast result",
            "4 · Browsers apply",
          ]
        : ["1 · Sensor", "2 · Relay", "3 · Browser apps"];
    $(".sim-message-progress").style.setProperty(
      "--sim-stage-count",
      stageNames.length,
    );
    $(".sim-message-progress").innerHTML = stageNames
      .map(
        (name, i) =>
          `<li data-message-stage="${i + 1}" class="${i + 1 === model.stage ? "active" : i + 1 < model.stage ? "complete" : ""}" ${i + 1 === model.stage ? 'aria-current="step"' : ""}>${name}</li>`,
      )
      .join("");
    $("#sim-message-cards").innerHTML = model.rows
      .map(
        (row, i) =>
          `<button class="sim-message-card ${row.state} ${row.transport.startsWith("Local") ? "local" : ""}" data-sim-message="${row.id}" type="button" aria-pressed="false"><span class="message-index">${String(i + 1).padStart(2, "0")}</span><span class="message-route">${row.from === row.to ? "Inside " + simulationParticipants[row.from].label : simulationParticipants[row.from].label + " → " + simulationParticipants[row.to].label}</span><span class="message-type">${escapeHTML(row.name)}<small>${row.transport.startsWith("Local") ? "LOCAL" : "WEBSOCKET"}</small></span><span class="message-preview">${escapeHTML(row.preview)}</span><span class="message-state">${row.state === "pending" ? "Not reached yet" : row.state === "active" ? "Current stage" : "Completed stage"}</span></button>`,
      )
      .join("");
    selectSimulationMessage(selectedSimulationMessage);
    if (changed) {
      const selected = $(
        '[data-sim-message="' + selectedSimulationMessage + '"]',
      );
      const container = $("#sim-message-cards");
      container.scrollTop +=
        selected.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        14;
    }
  }
  listen($("#sim-message-cards"), "click", (event) => {
    const button = event.target.closest("[data-sim-message]");
    if (button) selectSimulationMessage(button.dataset.simMessage);
  });

  function renderSimulationChart() {
    const cfg = simulation.config,
      samples = simulation.samples.slice(0, simulation.monitorReadings.length);
    const lower = cfg.threshold - cfg.hysteresis / 2,
      upper = cfg.threshold + cfg.hysteresis / 2;
    const values = cfg.readings;
    const lowest = Math.min(lower, ...values),
      highest = Math.max(upper, ...values);
    const pad = Math.max(0.35, (highest - lowest) * 0.15),
      min = lowest - pad,
      max = highest + pad;
    const bounds = $("#sim-chart").parentElement.getBoundingClientRect();
    const canvasWidth = 520;
    const canvasHeight = Math.max(
      260,
      Math.min(
        800,
        (canvasWidth * Math.max(1, bounds.height)) / Math.max(1, bounds.width),
      ),
    );
    $("#sim-chart").setAttribute(
      "viewBox",
      `0 0 ${canvasWidth} ${canvasHeight}`,
    );
    const left = 58,
      right = 460,
      top = 32,
      bottom = canvasHeight - 40;
    const x = (i) =>
      values.length === 1
        ? (left + right) / 2
        : left + (i * (right - left)) / (values.length - 1);
    const y = (value) =>
      bottom - ((value - min) * (bottom - top)) / (max - min);
    let content = `<rect x="${left}" y="${y(upper)}" width="${right - left}" height="${Math.max(1, y(lower) - y(upper))}" fill="#e3f0e7"/>`;
    for (let i = 0; i <= 4; i++) {
      const value = min + ((max - min) * i) / 4,
        py = y(value);
      content += `<path d="M${left} ${py}H${right}" stroke="#e4e9ed"/><text x="${left - 9}" y="${py + 3}" text-anchor="end" fill="#617184" font-size="11" font-family="var(--mono)">${escapeHTML(simNumber(value))}</text>`;
    }
    for (const [value, dash, stroke] of [
      [lower, "3 4", "#729a7c"],
      [upper, "3 4", "#729a7c"],
      [cfg.threshold, "6 4", "#5e748e"],
    ])
      content += `<path d="M${left} ${y(value)}H${right}" stroke="${stroke}" stroke-dasharray="${dash}"/>`;
    content += `<text x="${right + 7}" y="${y(upper) - 6}" fill="#42684e" font-size="11" font-family="var(--mono)">upper</text><text x="${right + 7}" y="${y(lower) + 12}" fill="#42684e" font-size="11" font-family="var(--mono)">lower</text>`;
    const tickIndices = [
      ...new Set([0, Math.floor((values.length - 1) / 2), values.length - 1]),
    ];
    tickIndices.forEach(
      (i) =>
        (content += `<text x="${x(i)}" y="${canvasHeight - 18}" text-anchor="middle" fill="#617184" font-size="11" font-family="var(--mono)">#${i + 1}</text>`),
    );
    if (samples.length)
      content += `<polyline points="${samples.map((s, i) => `${x(i)},${y(s.value)}`).join(" ")}" fill="none" stroke="#28694c" stroke-width="2.3" stroke-linejoin="round"/>`;
    samples.forEach((s, i) => {
      content += `<circle cx="${x(i)}" cy="${y(s.value)}" r="${s.event ? 5 : 3}" fill="${s.event ? "#a35a23" : "#28694c"}" stroke="white" stroke-width="1.5"/>`;
      if (s.event)
        content += `<text x="${x(i)}" y="${y(s.value) + (s.event.direction === "up" ? -12 : 20)}" text-anchor="middle" fill="#874819" font-size="11" font-family="var(--mono)">${simId(s.alert.id)} ${s.event.direction === "up" ? "↑" : "↓"}</text>`;
    });
    if (samples.length) {
      const last = samples.at(-1);
      content += `<circle cx="${x(samples.length - 1)}" cy="${y(last.value)}" r="8" fill="none" stroke="#28694c" stroke-width="1"/>`;
    } else
      content += `<g class="sim-chart-empty"><rect x="${canvasWidth / 2 - 174}" y="${canvasHeight / 2 - 20}" width="348" height="40" rx="8" fill="#ffffff" stroke="#e1e6ed"/><text x="${canvasWidth / 2}" y="${canvasHeight / 2 + 4}" text-anchor="middle" fill="#536574" font-size="12">Waiting for readings to reach the Live Monitor</text></g>`;
    $("#sim-chart").innerHTML = content;
    $("#sim-chart").setAttribute(
      "aria-label",
      `${samples.length} of ${values.length} samples received by the Monitor. Threshold ${cfg.threshold} degrees Celsius, hysteresis ${cfg.hysteresis}. ${samples.length ? `Latest sample ${samples.at(-1).value}. ${simulation.alertCount} crossing alerts detected.` : "No readings received by the Monitor yet."}`,
    );
  }
  function renderSimulationLog() {
    const events = simulation.events;
    // Preserve open payloads across stage updates.
    const open = new Set(
      $$("#sim-events details[open]").map((el) => el.dataset.event),
    );
    $("#sim-log-count").textContent = `${events.length} EVENTS`;
    $("#sim-events").innerHTML = events.length
      ? [...events]
          .reverse()
          .map(
            (event) =>
              `<li><details class="sim-event" data-event="${event.number}" ${open.has(String(event.number)) ? "open" : ""}><summary><time datetime="${event.time}">${event.time.slice(11, 19)}</time><span>#${event.sample} · ${escapeHTML(event.title)}</span></summary><pre>${escapeHTML(JSON.stringify(event.payload, null, 2))}</pre></details></li>`,
          )
          .join("")
      : '<li class="sim-empty">Events appear as you advance the simulation.</li>';
  }
  // Curated expectations are deliberately explicit, not produced by the detector under test.
  function matchingSimulationCase() {
    if (simulationSettingsChanges[simulation.scenario])
      return simulation.scenario;
    if (!$("#sim-input-error").hidden && !simulation.started) return null;
    const cfg = simulation.config;
    return (
      Object.keys(simulationCaseDefinitions).find((id) => {
        const preset = simulationPresets[id];
        return (
          preset.threshold === cfg.threshold &&
          preset.hysteresis === cfg.hysteresis &&
          preset.readings.length === cfg.readings.length &&
          preset.readings.every((value, i) => value === cfg.readings[i])
        );
      }) ?? null
    );
  }
  function renderSimulationPrediction() {
    const id = matchingSimulationCase(),
      definition = id ? simulationCaseDefinitions[id] : null;
    const grid = $("#sim-case-grid");
    if (!grid.childElementCount)
      grid.innerHTML = Object.entries(simulationCaseDefinitions)
        .map(
          ([key, entry]) =>
            `<button type="button" class="sim-case" data-sim-case="${key}" aria-pressed="false"><span class="sim-case-label">CASE ${entry.number}${icon("play")}</span><strong>${entry.title}</strong><span class="sim-case-description">${entry.description}</span><span class="sim-case-outcome">Expected: ${entry.events.length} ${entry.events.length === 1 ? "alert" : "alerts"}</span><small>${entry.events.length ? entry.events.map((event) => `${event.direction === "up" ? "↑" : "↓"} #${event.sample}`).join(" · ") : "No crossing events"}</small></button>`,
        )
        .join("");
    $$("[data-sim-case]").forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.simCase === id),
      ),
    );
    const observed = simulation.samples
      .filter((sample) => sample.event)
      .map((sample) => ({
        sample: sample.number,
        direction: sample.event.direction,
        value: sample.value,
      }));
    const matches =
      definition &&
      JSON.stringify(observed) === JSON.stringify(definition.events);
    const status = !definition
      ? "No predefined prediction"
      : simulation.index >= simulation.config.readings.length &&
          simulation.phase === 0
        ? matches
          ? "Prediction matched"
          : "Prediction did not match"
        : simulation.started
          ? "Compare as the sequence plays"
          : "Ready to test the prediction";
    const predictedEvents =
      definition?.events
        .map((event) => {
          const actual = simulation.samples.find(
            (sample) => sample.number === event.sample,
          );
          const matched =
            actual?.event?.direction === event.direction &&
            actual.value === event.value;
          return `<span class="sim-predicted-event ${actual ? (matched ? "observed" : "mismatch") : ""}">#${event.sample} ${event.direction === "up" ? "↑ up" : "↓ down"} · ${simTemperature(event.value)} · ${actual ? (matched ? "observed" : "not observed") : "expected"}</span>`;
        })
        .join("") ?? "";
    $("#sim-prediction").innerHTML =
      `<div><h3>${definition ? `Case ${definition.number} · ${definition.title}` : "Custom experiment"}</h3><p>${definition ? definition.why : $("#sim-input-error").hidden ? "No fixed expected outcome for these inputs. Follow each decision in the trace and compare it to the hysteresis boundaries." : "Fix the input errors before testing an outcome."}</p>${definition && definition.events.length === 0 ? '<div class="sim-prediction-events"><span class="sim-predicted-event">Expected: readings only · no alert messages</span></div>' : `<div class="sim-prediction-events">${predictedEvents}</div>`}</div><div><div class="sim-outcome-counts"><span>Expected alerts<strong id="sim-expected-count">${definition ? definition.events.length : "—"}</strong></span><span>Detected<strong id="sim-detected-count">${simulation.alertCount}</strong></span><span>Stored<strong id="sim-stored-count">${simulation.relayAlerts.length}</strong></span></div><div class="sim-expectation-result" id="sim-expectation-result">${status}</div></div>`;
  }
  function loadSimulationCase(id) {
    const preset = simulationPresets[id];
    if (!preset) return;
    $("#sim-preset").value = id;
    $("#sim-threshold").value = preset.threshold;
    $("#sim-hysteresis").value = preset.hysteresis;
    $("#sim-sequence").value = preset.readings.join(", ");
    const config = readSimulationConfig();
    if (config) {
      send({
        type: "RESTART",
        config,
        scenario: simulationSettingsChanges[id] ? id : null,
      });
    }
  }
  listen($("#sim-case-grid"), "click", (event) => {
    const button = event.target.closest("[data-sim-case]");
    if (button) loadSimulationCase(button.dataset.simCase);
  });

  // Guide chrome and simulator presentation controls; production behavior is unchanged.
  let guideSidebarPreference = null;
  try {
    const stored = localStorage.getItem("threshold-guide-sidebar-collapsed");
    if (stored !== null) guideSidebarPreference = stored === "true";
  } catch {
    /* Browser storage can be unavailable. */
  }
  function updateGuideNavigation(collapsed) {
    document.body.classList.toggle("nav-collapsed", collapsed);
    $("#guide-nav-toggle").setAttribute("aria-expanded", String(!collapsed));
    $("#guide-nav-toggle").setAttribute(
      "aria-label",
      collapsed ? "Expand navigation" : "Collapse navigation",
    );
    $("#guide-nav-backdrop").hidden = collapsed || innerWidth > 950;
  }
  function applyGuideLayout(page) {
    document.body.classList.toggle("is-simulator", page === "simulator");
    document.body.classList.toggle("is-code", page === "code");
    closeSimulationMessageTooltip();
    updateGuideNavigation(
      innerWidth <= 950
        ? true
        : (guideSidebarPreference ?? page === "simulator"),
    );
    if (page !== "simulator") {
      for (const dialog of $$(".sim-dialog")) if (dialog.open) dialog.close();
    }
  }
  listen($("#guide-nav-toggle"), "click", () => {
    guideSidebarPreference = !document.body.classList.contains("nav-collapsed");
    updateGuideNavigation(guideSidebarPreference);
    try {
      localStorage.setItem(
        "threshold-guide-sidebar-collapsed",
        String(guideSidebarPreference),
      );
    } catch {
      /* Browser storage can be unavailable. */
    }
  });
  listen($("#guide-nav-backdrop"), "click", () => updateGuideNavigation(true));
  $$("[data-page]").forEach((link) => {
    link.setAttribute("aria-label", link.querySelector("span").textContent);
    link.title = link.querySelector("span").textContent;
  });
  listen(window, "resize", () => {
    updateGuideNavigation(
      innerWidth <= 950
        ? true
        : (guideSidebarPreference ??
            document.body.classList.contains("is-simulator")),
    );
  });
  function setWorkspaceView(view) {
    $(".sim-main-grid").dataset.workspaceView = view;
    $$("[data-workspace-view]")
      .filter((el) => el.tagName === "BUTTON")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.workspaceView === view),
        ),
      );
  }
  $$("button[data-workspace-view]").forEach((button) =>
    listen(button, "click", () =>
      setWorkspaceView(button.dataset.workspaceView),
    ),
  );
  function openSimulatorDialog(id) {
    const dialog = $("#" + id);
    if (!dialog.open) dialog.showModal();
  }
  listen($("#sim-open-settings"), "click", () =>
    openSimulatorDialog("sim-settings-dialog"),
  );
  listen($("#sim-open-details"), "click", () =>
    openSimulatorDialog("sim-inspect-dialog"),
  );
  $$("[data-close-dialog]").forEach((button) =>
    listen(button, "click", () => $("#" + button.dataset.closeDialog).close()),
  );
  $$(".sim-dialog").forEach((dialog) =>
    listen(dialog, "click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    }),
  );
  $$("[data-inspect-tab]").forEach((button) =>
    listen(button, "click", () => {
      $$("[data-inspect-tab]").forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
      for (const id of ["trace", "state", "log"])
        $("#sim-inspect-" + id).hidden = id !== button.dataset.inspectTab;
      if (button.dataset.inspectTab === "log") $("#sim-event-log").open = true;
    }),
  );
  const editReset = document.createElement("button");
  editReset.id = "sim-edit-reset";
  editReset.className = "plain-button";
  editReset.type = "button";
  editReset.textContent = "Restart to edit";
  $("#sim-settings-dialog .sim-dialog-heading").insertBefore(
    editReset,
    $("#sim-settings-dialog [data-close-dialog]"),
  );
  listen(editReset, "click", () => $("#sim-restart").click());
  listen($("#sim-case-picker"), "change", () => {
    const id = $("#sim-case-picker").value;
    if (id === "custom") {
      openSimulatorDialog("sim-settings-dialog");
      $("#sim-sequence").focus();
      return;
    }
    loadSimulationCase(id);
  });
  function renderSimulatorWorkspace() {
    const caseId = matchingSimulationCase();
    $("#sim-case-picker").value = caseId ?? "custom";
    const open = simulation.controlAlerts.filter(
      (record) => !record.acknowledgement,
    ).length;
    $("#sim-open-alarms").textContent = `${open} open`;
    $("#sim-mobile-alarm-count").textContent = String(open);
    $(".sim-control-panel").classList.toggle("has-new-alarm", open > 0);
    $("#sim-edit-reset").hidden = !simulation.started;
    $("#sim-operator-hint").textContent = simulation.ack
      ? "Request sent. Press Step for relay storage, Step for broadcast, then Step for the browser update."
      : open
        ? "Press Acknowledge to send a request, then Step through storage, broadcast, and the browser update."
        : "When an alarm arrives, press Acknowledge to send your confirmation to the relay.";
  }

  let simulationSessionRestored = controller.restored;
  function renderLiveSimulationSettings() {
    const cfg = simulation.config;
    $("#sim-live-config").innerHTML =
      icon("pulse") +
      `<strong>Sensor threshold ${simTemperature(cfg.threshold)}</strong><span>· hysteresis ${simTemperature(cfg.hysteresis)}</span>`;
    const change = simulationSettingsChanges[simulation.scenario];
    const configuring = Boolean(change);
    const phase = simulation.settingsPhase;
    $("#sim-settings-progress").innerHTML = configuring
      ? icon(phase === 3 ? "check" : "monitor") +
        (phase === 0
          ? `After reading #2: Monitor will request ${change.label}`
          : phase === 1
            ? `<span data-pending>Monitor requested ${change.label} · awaiting relay</span>`
            : phase === 2
              ? `<span data-pending>Relay saved ${change.label} · awaiting sensor receipt</span>`
              : `${change.label} received by sensor · configuration creates no alert`)
      : icon("shield") +
        "Readings create crossing alerts; configuration changes do not";
  }
  function saveSimulationSession() {
    const saved = saveSession({
      version: 1,
      simulation,
      inputs: {
        threshold: $("#sim-threshold").value,
        hysteresis: $("#sim-hysteresis").value,
        sequence: $("#sim-sequence").value,
      },
      view: $(".sim-main-grid").dataset.workspaceView,
    });
    $("#sim-local-save").textContent = saved
      ? simulationSessionRestored
        ? "Restored · saved locally"
        : "Saved in this browser"
      : "Local saving unavailable";
    $("#sim-local-save").title =
      "Scenario, readings, configuration, alerts and the current stage survive refresh. Only Step advances the run.";
  }
  function restoreSimulationSession() {
    const saved = controller.session;
    if (!saved) return;
    $("#sim-threshold").value = saved.inputs.threshold;
    $("#sim-hysteresis").value = saved.inputs.hysteresis;
    $("#sim-sequence").value = saved.inputs.sequence;
    $("#sim-preset").value = matchingSimulationCase() ?? "custom";
    setWorkspaceView(saved.view);
  }
  function renderSimulation() {
    const cfg = simulation.config,
      latest = simulation.monitorReadings.at(-1);
    $("#sim-fields").disabled = simulation.started;
    $("#sim-lock-hint").textContent = simulation.started
      ? `Starting inputs are locked for this run. Active sensor threshold: ${simTemperature(cfg.threshold)}; hysteresis: ${simTemperature(cfg.hysteresis)}. Restart restores the starting inputs.`
      : "Edit first, then play. Restart clears the run and unlocks configuration.";
    $("#sim-lower").textContent = simTemperature(
      cfg.threshold - cfg.hysteresis / 2,
    );
    $("#sim-center").textContent = simTemperature(cfg.threshold);
    $("#sim-upper").textContent = simTemperature(
      cfg.threshold + cfg.hysteresis / 2,
    );
    $("#sim-sample-counter").textContent =
      `${simulation.monitorReadings.length} / ${cfg.readings.length} SAMPLES`;
    $("#sim-sequence-chips").innerHTML = cfg.readings
      .map(
        (value, i) =>
          `<span class="sim-sample-chip ${simulation.samples[i] ? "processed" : ""} ${simulation.current?.number === i + 1 ? "current" : ""} ${simulation.samples[i]?.event ? "crossing" : ""}" ${simulation.current?.number === i + 1 ? 'aria-current="step"' : ""}><small>#${i + 1}</small>${escapeHTML(simNumber(value))}</span>`,
      )
      .join("");
    renderSimulationMessages();
    $("#sim-run-status").textContent = simulation.status;
    $("#sim-stage-label").textContent =
      simulation.messageJourney?.kind === "settings"
        ? "Monitor → relay → sensor / configure without creating an alarm"
        : simulation.messageJourney?.kind === "ack"
          ? "Operator acknowledgement / separate from accepted"
          : simulation.active
            ? `${simulation.active === "views" ? "Browser apps" : simulation.active} / sample ${simulation.current.number}`
            : "Ready / a successful delivery path";
    $("#sim-decision-title").textContent = simulation.title;
    $("#sim-decision-reason").textContent = simulation.reason;
    $("#sim-sensor-value").textContent = simulation.current
      ? simTemperature(simulation.current.value)
      : "—";
    $("#sim-detector-state").textContent =
      simulation.detector.side ?? "Not initialized";
    $("#sim-previous-state").textContent =
      simulation.previous ?? "Not initialized";
    $("#sim-outbox-count").textContent =
      `${simulation.pending.length} ${simulation.pending.length === 1 ? "alert" : "alerts"}`;
    $("#sim-db-count").textContent = `${simulation.relayAlerts.length} RECORDS`;
    $("#sim-monitor-value").textContent = latest
      ? simTemperature(latest.value)
      : "—";
    $("#sim-monitor-side").textContent = latest
      ? `${latest.value > cfg.threshold ? "Above" : "Below"} threshold`
      : "Waiting for a reading";
    const finished = simulationFinished();
    $("#sim-next").disabled = finished;
    renderSimulationChart();
    renderSimulationLog();
    renderSimulationPrediction();
    renderSimulatorWorkspace();
    renderLiveSimulationSettings();
    $("#sim-print-summary").innerHTML =
      `<h3>Simulation configuration & results</h3><p>Illustrative local model. Threshold ${simTemperature(cfg.threshold)}, hysteresis ${simTemperature(cfg.hysteresis)}. ${simulation.samples.length}/${cfg.readings.length} samples processed; ${simulation.relayAlerts.length} alerts stored; ${simulation.relayAlerts.filter((r) => r.acknowledgement).length} acknowledged. ${escapeHTML(simulation.status)}.</p><p>Configured sequence: ${cfg.readings.map(simNumber).join(", ")}.</p><table><thead><tr><th>Sample</th><th>Value</th><th>Detector event</th><th>Relay / browser delivery</th></tr></thead><tbody>${simulation.samples.map((s) => `<tr><td>#${s.number}</td><td>${simTemperature(s.value)}</td><td>${s.event ? `${s.event.direction} · ${simId(s.alert.id)}` : "No crossing"}</td><td>${s.number <= simulation.index ? "Delivered to browser" : simulation.phase === 2 ? "At relay" : "At sensor"}</td></tr>`).join("")}</tbody></table>`;
  }
  function updateSimulationDraft() {
    if (simulation.started) return;
    $("#sim-preset").value = "custom";
    const config = readSimulationConfig();
    if (!config) renderSimulationPrediction();
    $("#sim-next").disabled = !config;
    if (config) {
      send({ type: "RESTART", config });
    }
  }
  listen($("#sim-config"), "submit", (event) => event.preventDefault());
  listen($("#sim-preset"), "change", () =>
    loadSimulationCase($("#sim-preset").value),
  );
  for (const id of ["sim-threshold", "sim-hysteresis", "sim-sequence"])
    listen($("#" + id), "input", updateSimulationDraft);
  listen($("#sim-next"), "click", advanceSimulation);
  listen($("#sim-restart"), "click", () => {
    const scenario = simulation.scenario;
    const config = readSimulationConfig();
    send({
      type: "RESTART",
      config: config ?? structuredClone(simulationPresets.crossings),
      scenario,
    });
    if (!config) {
      $("#sim-next").disabled = true;
    }
  });
  listen(window, "pagehide", saveSimulationSession);
  $$("button[data-workspace-view]").forEach((button) =>
    listen(button, "click", saveSimulationSession),
  );
  restoreSimulationSession();
  renderSimulation();
  const resizeObserver = new ResizeObserver(() => {
    if (!$("#simulator").hidden) renderSimulationChart();
  });
  resizeObserver.observe($("#sim-chart").parentElement);

  const titles = {
    overview: "System overview",
    simulator: "Live simulator",
    code: "Code explorer",
  };
  function showPage(id, scroll = true) {
    // Existing journey bookmarks now open the simulator’s message trace.
    if (id === "flows") {
      id = "simulator";
      history.replaceState(null, "", "#simulator");
    }
    if (id === "state" || id === "react") {
      id = "code";
      history.replaceState(null, "", "#code");
    }
    if (!titles[id]) id = "overview";
    applyGuideLayout(id);
    $$(".page").forEach((p) => (p.hidden = p.id !== id));
    $$("[data-page]").forEach((a) => {
      if (a.dataset.page === id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    $("#breadcrumb-current").textContent = titles[id];
    document.title = `${titles[id]} · ${chapterText("Architecture Guide", guideLanguage)} · Threshold Monitor`;
    if (scroll) $("#main").scrollTo({ top: 0, behavior: "instant" });
    closeSearch();
  }
  function navigate(id) {
    if (!titles[id]) id = "overview";
    if (location.hash !== "#" + id) history.pushState(null, "", "#" + id);
    showPage(id);
    $("#main").focus({ preventScroll: true });
  }
  listen(document, "click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || !titles[link.hash.slice(1)]) return;
    event.preventDefault();
    navigate(link.hash.slice(1));
    const target = document.getElementById(link.dataset.guideTarget);
    if (target && !target.closest(".page")?.hidden) {
      if (target.tagName === "DETAILS") target.open = true;
      for (
        let parent = target.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        if (parent.tagName === "DETAILS") parent.open = true;
      }
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start" });
    }
  });
  listen(window, "popstate", () => showPage(location.hash.slice(1)));
  listen(window, "load", () => $("#main").scrollTo(0, 0), {
    once: true,
  });
  listen(window, "hashchange", () => showPage(location.hash.slice(1)));
  showPage(location.hash.slice(1) || "overview", false);
  let searchIndex = [];
  function rebuildSearchIndex() {
    searchIndex = [
      ...Object.entries(titles).map(([page, title]) => ({
        page,
        title,
        text: $("#" + page).textContent,
        kind: chapterText("Guide section", guideLanguage),
      })),
      ...$$("[data-code-panel]").map((panel) => ({
        page: "code",
        code: panel.dataset.codePanel,
        title: $(".code-toolbar code", panel).textContent,
        text: panel.textContent,
        kind: chapterText("Source file", guideLanguage),
      })),
    ];
  }
  const disposeChapterLanguage = mountChapterLanguage((language) => {
    guideLanguage = language;
    controller.onLanguageChange?.(language);
    Object.assign(titles, chapterTitles(language));
    rebuildSearchIndex();
    showPage(location.hash.slice(1) || "overview", false);
  });
  function closeSearch() {
    $("#search-results").hidden = true;
  }
  listen($("#guide-search"), "input", () => {
    const query = $("#guide-search").value.trim().toLowerCase();
    if (query.length < 2) {
      closeSearch();
      return;
    }
    const results = searchIndex
      .filter((item) =>
        (item.title + " " + item.text).toLowerCase().includes(query),
      )
      .sort(
        (a, b) =>
          Number(b.title.toLowerCase().includes(query)) -
          Number(a.title.toLowerCase().includes(query)),
      )
      .slice(0, 9);
    $("#search-results").innerHTML = results.length
      ? results
          .map(
            (r, i) =>
              `<button class="search-result" data-result="${i}"><strong>${escapeHTML(r.title)}</strong><small>${escapeHTML(r.kind)} · ${escapeHTML(titles[r.page])}</small></button>`,
          )
          .join("")
      : `<p class="search-empty">${guideLanguage === "de" ? "Keine Treffer. Versuche „Outbox“, „Hooks“ oder „SQLite“." : "No matches. Try “outbox”, “hooks”, or “SQLite”."}</p>`;
    $("#search-results").hidden = false;

    $$("[data-result]").forEach((b) =>
      listen(b, "click", () => {
        const r = results[Number(b.dataset.result)];
        if (r.code) selectCode(r.code);
        navigate(r.page);
        closeSearch();
        $("#guide-search").value = "";
      }),
    );
  });
  listen(document, "keydown", (e) => {
    if (e.key === "Escape") closeSearch();
    if (
      e.key === "/" &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
    ) {
      e.preventDefault();
      $("#guide-search").focus();
    }
    if (
      e.key === "ArrowDown" &&
      document.activeElement === $("#guide-search") &&
      !$("#search-results").hidden
    ) {
      e.preventDefault();
      $(".search-result")?.focus();
    }
  });
  listen(document, "click", (e) => {
    if (!e.target.closest(".search-wrap")) closeSearch();
  });
  listen($("#print-guide"), "click", () => {
    window.print();
  });
  return {
    acknowledge(id) {
      requestSimulationAck(id);
    },
    update(state) {
      simulation = state;
      renderSimulation();
    },
    dispose() {
      editReset.remove();
      listeners.forEach((remove) => remove());
      resizeObserver.disconnect();
      disposeCode();
      disposeChapterLanguage();
      clearTimeout(simulationTooltipCloseTimer);
    },
  };
}
