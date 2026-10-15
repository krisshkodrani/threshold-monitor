import type { SettingsRecord } from "@app/protocol";
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { defaults } from "../config";

/**
 * The shared detection settings, as the relay stores them (ADR 0009). Null
 * until the relay sends them; the views then use `defaults`.
 */
export type SettingsState = { current: SettingsRecord | null };

const initialState: SettingsState = { current: null };

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    settingsReceived(state, action: PayloadAction<SettingsRecord | null>) {
      state.current = action.payload;
    },
  },
});

export const { settingsReceived } = settingsSlice.actions;
export const settingsReducer = settingsSlice.reducer;

/** The values that the chart and the readout use. */
export const selectDetectorConfig = (state: { settings: SettingsState }) =>
  state.settings.current ?? defaults;
