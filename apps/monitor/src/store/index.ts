import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";
import { alertsReducer } from "./alertsSlice";
import { sensorReducer } from "./sensorSlice";
import { settingsReducer } from "./settingsSlice";

/**
 * Redux holds only low-frequency, user-meaningful state: the shared settings,
 * the alerts and the sensor. Live readings bypass it
 * (readingsStore).
 */
const rootReducer = combineReducers({
  settings: settingsReducer,
  alerts: alertsReducer,
  sensor: sensorReducer,
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
