import { combineReducers, configureStore } from '@reduxjs/toolkit';
import userReducer from './user/userSlice';
import { persistReducer, createTransform, type PersistConfig } from "redux-persist";
import storage from 'redux-persist/lib/storage';

type RootStateShape = { user: ReturnType<typeof userReducer> };

// A blacklist is matched against root state keys, and combineReducers leaves
// exactly one -- `user` -- so the previous `blacklist: ['error', 'message',
// 'isLoading']` filtered nothing and the whole slice kept being written. Those
// fields sit one level down, where only a transform reaches them. It matters: a
// rejected sign-up sets `error` and nothing clears it, and /signup toasts it
// from a mount effect, so reloading re-fired "Email already registered" for a
// form that was blank; and a refresh during a request rehydrated
// `isLoading: true`, leaving the submit button disabled with no thunk running
// that could ever clear it.
const userTransform = createTransform<
  Record<string, unknown>,
  Record<string, unknown>,
  RootStateShape
>(
  (inbound, key) =>
    key === "user"
      ? { ...inbound, error: null, message: null, isLoading: false }
      : inbound,
  undefined,
  { whitelist: ["user"] }
);

const persistConfig: PersistConfig<RootStateShape> = {
  key: 'root',
  storage,
  transforms: [userTransform],
}

const rootReducer = combineReducers({
  user: userReducer,
})

const persistedReducer = persistReducer(persistConfig, rootReducer)

const store = configureStore({
  reducer: persistedReducer,
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;

export const server = process.env.NEXT_PUBLIC_API_URL || "";
