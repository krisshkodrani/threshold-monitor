export const simulationCaseDefinitions = {
  hysteresis: {
    number: "07",
    title: "Adjust the hysteresis band",
    description:
      "After reading #2, narrow the band from 0.6°C to 0.2°C while keeping threshold 25°C.",
    why: "The old edges are 24.7°C and 25.3°C; the new edges are 24.9°C and 25.1°C. Changing settings creates no alert. Reading #3 stays above after silent reclassification; #4 (24.85°C) crosses down and #5 (25.15°C) crosses up. Both later values would stay inside the old band.",
    events: [
      { sample: 4, direction: "down", value: 24.85 },
      { sample: 5, direction: "up", value: 25.15 },
    ],
  },
  configure: {
    number: "06",
    title: "Monitor configures alarm",
    description:
      "After reading #2, lower the threshold from 25°C to 24°C from the Monitor.",
    why: "Configuration alone creates no alert. Before #3 the previous value is silently reclassified above the new threshold. Only #4 (23.6°C) crosses below the new lower edge, 23.7°C.",
    events: [{ sample: 4, direction: "down", value: 23.6 }],
  },
  crossings: {
    number: "01",
    title: "Cross both directions",
    description: "Rise above the upper edge, then fall below the lower edge.",
    why: "Exact-edge readings #3 and #6 do not trigger. Expect an up alert at #4 and a down alert at #7.",
    events: [
      { sample: 4, direction: "up", value: 25.4 },
      { sample: 7, direction: "down", value: 24.6 },
    ],
  },
  noise: {
    number: "02",
    title: "Ignore threshold noise",
    description: "Move above and below 25°C without leaving the band.",
    why: "The detector starts below and never sees a value strictly above 25.3°C. Crossing the center threshold alone is not enough.",
    events: [],
  },
  zero: {
    number: "03",
    title: "Remove hysteresis",
    description: "Alternate around 25°C with no noise-suppression band.",
    why: "With hysteresis 0, the edges both equal 25°C. Expect up at #2, down at #3, and up at #4.",
    events: [
      { sample: 2, direction: "up", value: 25.1 },
      { sample: 3, direction: "down", value: 24.9 },
      { sample: 4, direction: "up", value: 25.1 },
    ],
  },
  edges: {
    number: "04",
    title: "Touch the exact edges",
    description:
      "Compare equality at 25.3°C and 24.7°C with a strict crossing.",
    why: "#2 equals the upper edge and #4 equals the lower edge: neither triggers. Only #3 and #5 cross strictly beyond their edges.",
    events: [
      { sample: 3, direction: "up", value: 25.4 },
      { sample: 5, direction: "down", value: 24.6 },
    ],
  },
  initial: {
    number: "05",
    title: "Start above threshold",
    description: "An initially high value establishes state, without an alarm.",
    why: "The first value is 26°C, but there was no transition. Only the later fall below 24.7°C creates a down alert at #4.",
    events: [{ sample: 4, direction: "down", value: 24.6 }],
  },
};
