import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import { User } from "@/types";
import { server } from "../store";
import axios from "axios";

type UserState = {
  error: string | null;
  message: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  user: User | null;
};

// Only a definitive 401/403 invalidates the httpOnly session cookie. A network
// failure or a 500 says nothing about the session, so it must not log the user
// out in Redux while the server still accepts the cookie.
type SessionError = {
  message: string;
  unauthenticated: boolean;
};

const initialState: UserState = {
  error: null,
  message: null,
  isAuthenticated: false,
  isLoading: false,
  user: null,
};

export const registerUser = createAsyncThunk(
  "user/register",
  async (
    {
      name,
      email,
      password,
    }: { name: string; email: string; password: string },
    thunkAPI
  ) => {
    try {
      const response = await axios.post(
        `${server}/api/auth/register`,
        { name, email, password },
        { withCredentials: true }
      );
      return response.data.user;
    } catch (error: any) {
      return thunkAPI.rejectWithValue(
        error?.response?.data?.message || "Sign up failed. Please try again."
      );
    }
  }
);

export const loginUser = createAsyncThunk(
  "user/login",
  async (
    { email, password }: { email: string; password: string },
    thunkAPI
  ) => {
    try {
      const response = await axios.post(
        `${server}/api/auth/login`,
        { email, password },
        { withCredentials: true }
      );
      return response.data.user;
    } catch (error: any) {
      return thunkAPI.rejectWithValue(
        error?.response?.data?.message || "Login failed. Please try again."
      );
    }
  }
);

export const logoutUser = createAsyncThunk(
  "user/logout",
  async (_, thunkAPI) => {
    try {
      const response = await axios.post(
        `${server}/api/auth/logout`,
        {},
        { withCredentials: true }
      );
      return response.data.message;
    } catch (error: any) {
      return thunkAPI.rejectWithValue(
        error?.response?.data?.message || "Logout failed."
      );
    }
  }
);

export const getCurrentUser = createAsyncThunk(
  "user/getCurrentUser",
  async (_, thunkAPI) => {
    try {
      const response = await axios.get(`${server}/api/profile`, {
        withCredentials: true,
        // The login/signup pages abort this mount-time check as soon as the
        // user submits. Without the signal, a slow 401 could still land after
        // a successful sign-in and clear the fresh session from Redux.
        signal: thunkAPI.signal,
      });
      return response.data.user;
    } catch (error: any) {
      const status = error?.response?.status;
      return thunkAPI.rejectWithValue({
        message:
          error?.response?.data?.message ||
          (status === 401 || status === 403
            ? "Session expired. Please log in."
            : "Could not verify your session. Please try again."),
        unauthenticated: status === 401 || status === 403,
      } satisfies SessionError);
    }
  }
);

const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    resetUser: (state) => {
      state.user = null;
      state.isAuthenticated = false;
      state.isLoading = false;
      state.error = null;
      state.message = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginUser.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(loginUser.fulfilled, (state, action: PayloadAction<User>) => {
        state.isLoading = false;
        state.isAuthenticated = true;
        state.user = action.payload;
        state.error = null;
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.isLoading = false;
        // A bad password says nothing about an existing httpOnly session. The
        // API does not clear the cookie on 400, so wiping Redux here left a
        // working dashboard showing "TaskFlow" instead of the signed-in user.
        // The login page now waits for a successful thunk before redirecting.
        state.error = (action.payload as string) || "Login failed. Please try again.";
      })

      .addCase(registerUser.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(registerUser.fulfilled, (state, action: PayloadAction<User>) => {
        state.isLoading = false;
        state.isAuthenticated = true;
        state.user = action.payload;
        state.error = null;
      })
      .addCase(registerUser.rejected, (state, action) => {
        state.isLoading = false;
        // Same rule as login: a duplicate email or validation error must not
        // invalidate a session cookie the server never touched.
        state.error = action.payload as string;
      })

      .addCase(logoutUser.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(logoutUser.fulfilled, (state) => {
        state.isLoading = false;
        state.isAuthenticated = false;
        state.user = null;
        state.error = null;
      })
      .addCase(logoutUser.rejected, (state, action) => {
        state.isLoading = false;
        state.error = (action.payload as string) || "Logout failed. Please try again.";
        // Keep the user signed in. A failed request means the server never
        // cleared the httpOnly cookie, so the session is still live: clearing
        // `user` here only made the UI claim otherwise, and the next protected
        // request kept succeeding. The caller navigates away only on success.
      })

      .addCase(getCurrentUser.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(
        getCurrentUser.fulfilled,
        (state, action: PayloadAction<User>) => {
          state.isLoading = false;
          state.isAuthenticated = true;
          state.user = action.payload;
          state.error = null;
        }
      )
      .addCase(getCurrentUser.rejected, (state, action) => {
        // An aborted check was superseded by a fresh login/register. It carries
        // no verdict about that new session, so leave the state alone -- including
        // `isLoading`, which the new request owns now.
        if (action.meta.aborted) return;
        state.isLoading = false;
        const payload = action.payload as SessionError | undefined;
        state.error =
          payload?.message || "User not found. Please try logging in.";
        // A transient failure leaves the live cookie and the persisted user
        // alone, so one dropped request cannot render a signed-in visitor as
        // logged out until they manually sign in again.
        if (payload?.unauthenticated) {
          state.isAuthenticated = false;
          state.user = null;
        }
      });
  },
});

export const userActions = userSlice.actions;
export default userSlice.reducer;
