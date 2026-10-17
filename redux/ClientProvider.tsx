"use client";
import { useMemo } from "react";
import { Provider } from "react-redux";
import store from "./store";
import { persistStore } from "redux-persist";
import { PersistGate } from "redux-persist/integration/react";

export default function ClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Created once. Calling persistStore() in the render body minted a new
  // persistor on every render; only the first is ever registered with the
  // store, so each extra one never becomes "bootstrapped" and its PersistGate
  // sat on the 5s timeout fallback — blank screen on load under StrictMode's
  // double render, plus a stray timeout dispatching a spurious REHYDRATE.
  const persistor = useMemo(() => persistStore(store), []);
  return (
    <Provider store={store}>
      <PersistGate persistor={persistor}>{children}</PersistGate>
    </Provider>
  );
}
