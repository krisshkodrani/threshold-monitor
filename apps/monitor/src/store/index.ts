import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";
import { alertsReducer } from "./alertsSlice";
import { connectionReducer } from "./connectionSlice";
import { thresholdReducer } from "./thresholdSlice";

/**
 * Redux holds only low-frequency, user-meaningful state: settings, alerts and
 * the connection status. Live readings deliberately bypass it (readingsStore).
 */
const rootReducer = combineReducers({
  threshold: thresholdReducer,
  alerts: alertsReducer,
  connection: connectionReducer,
});

export type RootState = ReturnType<typeof rootReducer>;

export function createAppStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: rootReducer,
    ...(preloadedState ? { preloadedState } : {}),
  });
}

export type AppStore = ReturnType<typeof createAppStore>;
export type AppDispatch = AppStore["dispatch"];

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
