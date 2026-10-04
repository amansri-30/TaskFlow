import { combineReducers, configureStore } from '@reduxjs/toolkit';
import userReducer from './user/userSlice';
import { persistReducer } from "redux-persist";
import storage from 'redux-persist/lib/storage';

const persistConfig = {
  key: 'root',
  storage,
  // The whole `user` slice was being written to localStorage, including `error`.
  // A rejected sign-up sets that field and nothing ever clears it, and /signup
  // toasts `error` from a mount effect -- so reloading the page after a failed
  // attempt re-fired "Email already registered" for a submission that no longer
  // existed on screen. Transient request state has no business surviving a
  // reload; only the signed-in identity does.
  blacklist: ['error', 'message', 'isLoading'],
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