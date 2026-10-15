import type { SensorInfo } from "@app/protocol";
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/** The sensor that sends the readings; null while none is connected. */
export type SensorState = { sensor: SensorInfo | null };

const initialState: SensorState = { sensor: null };

const sensorSlice = createSlice({
  name: "sensor",
  initialState,
  reducers: {
    sensorChanged(state, action: PayloadAction<SensorInfo | null>) {
      state.sensor = action.payload;
    },
  },
});

export const { sensorChanged } = sensorSlice.actions;
export const sensorReducer = sensorSlice.reducer;
