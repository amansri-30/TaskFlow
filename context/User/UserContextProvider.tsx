"use client";

import { useState, ReactNode, useEffect } from "react";
import { User } from "../../types";
import { UserContext } from "./UserContext";
import { EmptyUserObject } from "@/lib/objects";
import { useAppDispatch } from "@/hooks";
import { getCurrentUser } from "@/redux/user/userSlice";

type ContextProviderProps = {
  children: ReactNode;
};

export default function UserContextProvider({ children }: ContextProviderProps) {
  const [user, setUser] = useState<User>(EmptyUserObject);
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(getCurrentUser());
  }, [dispatch]);

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  );
}