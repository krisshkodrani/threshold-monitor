# ADR 0009: A sensor agent makes the data, the monitor shows it

Status: accepted (M9)

## Context

Before M9, each monitor tab made its own readings, found its own crossings
and sent its own alerts. This had three problems:

- Two monitor tabs showed different data and sent different alerts for the
  same "sensor".
- When the tab was closed, the data and the alerts stopped. A hidden tab
  needed a catch-up from the clock to fill the gap.
- The threshold and the hysteresis were in the `localStorage` of one browser.
  Other people did not see them and could not change them.

A real system has one sensor. The browser only shows its data.

## Decision

- **A new service, `sensor/`.** A Node process makes the readings (the same
  random walk), finds the crossings (the same Schmitt trigger, ADR 0003) and
  sends the alerts (the same outbox, ADR 0004). The domain and transport code
  moved from `apps/monitor` with `git mv`, with their tests.
- **The sensor proves itself with a token.** A service has no session cookie.
  Its `hello` has the role `sensor`, the token and its info (id, label, rate).
  The relay compares the token with `SENSOR_TOKEN` in constant time. Without
  `SENSOR_TOKEN`, no sensor can connect.
- **One sensor at a time.** A sensor with a different id is closed with
  **4005**. The same sensor id replaces its old connection at once, because
  after a network drop the old socket can stay half-open for up to 30 s.
- **Protocol version 3.** New messages: `reading` (sensor to relay to
  monitors), `settingsApplied` (sensor), `setSettings` (monitor), `settings`
  and `sensorStatus` (relay). `welcome` has the settings, the sensor and,
  for monitors, the last 120 readings.
- **Readings are sent at most once.** They go only while the sensor is
  connected, are not stored and are not confirmed. The relay keeps the last
  120 in memory for `welcome`. Alerts stay at least once.
- **Shared settings.** A monitor sends `setSettings`. The relay checks the
  limits (`SETTINGS_LIMITS`), stores the settings with the user's name in
  SQLite, and sends them to the sensor and to all monitors. The sensor's
  defaults are stored only when nothing is stored yet.
- **The sensor has its own rate limit:** capacity 600, refill 50 each second.
- **The monitor is a view.** It has no data source, detector or outbox. Its
  alert log shows the relay's records. The latency is the relay's
  `receivedAt` minus the sensor's `eventTime`, so both times come from
  backend clocks.
- The relay still does no domain logic. It checks, stores and forwards.

## Consequences

- All monitor tabs show the same readings, alerts and settings. The data
  continues when no tab is open.
- A settings change is visible to all users, with the name of the person who
  made it.
- The deployment has one more process. Docker Compose runs it as a second
  container from the same image.
- The URL parameters `?rate` and `?seed`, the pause button and the settings
  in `localStorage` are removed. The sensor reads `SENSOR_RATE_HZ` and
  `SENSOR_SEED`.
- The outbox is in memory only. On SIGTERM, the sensor waits up to 3 s for
  the relay to accept the queued alerts. If the relay is offline for all of
  that time, the alerts are lost and the sensor logs their count.
- Only one sensor is supported. More sensors need a sensor id in each
  message and a sensor choice in the monitor.
