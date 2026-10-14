import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ConnectionStatus } from "../transport/AlertTransport";

export type ConnectionState = { status: ConnectionStatus };

const initialState: ConnectionState = { status: { kind: "connecting" } };

const connectionSlice = createSlice({
  name: "connection",
  initialState,
  reducers: {
    statusChanged(state, action: PayloadAction<ConnectionStatus>) {
      state.status = action.payload;
    },
  },
});

export const { statusChanged } = connectionSlice.actions;
export const connectionReducer = connectionSlice.reducer;
