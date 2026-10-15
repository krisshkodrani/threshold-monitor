# ADR 0003: Edge-triggered crossing detection with hysteresis

Status: accepted (M2, M3)

## Context

A noisy value near the threshold crosses it many times in a short period. One
alert for each small crossing gives too many alerts. The operator needs one
alert when the value really moves to the other side.

## Decision

- The detector is a Schmitt trigger. The band is
  `[threshold − hysteresis / 2, threshold + hysteresis / 2]`.
- The detector keeps a side (above or below). An alert occurs only when a
  reading leaves the band on the other side. Comparisons are strict.
- The first reading sets the side and never causes an alert. Readings that are
  not finite numbers are ignored.
- A change of the threshold or the hysteresis never causes an alert. At the
  next reading, the detector sets its side again from the new settings.
- The detector is a pure function. Five fast-check properties test it,
  including "hysteresis never produces more events than a plain detector".

## Consequences

- With hysteresis 0, the detector is a plain edge detector.
- A value that stays inside the band never causes an alert, also when it
  passes the threshold many times.
