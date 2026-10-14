import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { defaults } from "../config";

export type ThresholdState = { threshold: number; hysteresis: number };

export const initialThresholdState: ThresholdState = {
  threshold: defaults.threshold,
  hysteresis: defaults.hysteresis,
};

// Values arrive already validated (parseThresholdInput, slider bounds), so the
// reducers just store them.
const thresholdSlice = createSlice({
  name: "threshold",
  initialState: initialThresholdState,
  reducers: {
    thresholdCommitted(state, action: PayloadAction<number>) {
      state.threshold = action.payload;
    },
    hysteresisChanged(state, action: PayloadAction<number>) {
      state.hysteresis = action.payload;
    },
  },
});

export const { thresholdCommitted, hysteresisChanged } = thresholdSlice.actions;
export const thresholdReducer = thresholdSlice.reducer;
