import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { CurrentUserDto, Permission } from '@spaceflow/shared';

export interface AuthState {
  accessToken: string | null;
  user: CurrentUserDto | null;
  /** true until the initial silent refresh has completed */
  bootstrapping: boolean;
}

const initialState: AuthState = { accessToken: null, user: null, bootstrapping: true };

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    sessionStarted(state, action: PayloadAction<{ accessToken: string; user: CurrentUserDto }>) {
      state.accessToken = action.payload.accessToken;
      state.user = action.payload.user;
      state.bootstrapping = false;
    },
    userUpdated(state, action: PayloadAction<CurrentUserDto>) {
      state.user = action.payload;
    },
    tokenRefreshed(state, action: PayloadAction<string>) {
      state.accessToken = action.payload;
    },
    sessionEnded(state) {
      state.accessToken = null;
      state.user = null;
      state.bootstrapping = false;
    },
    bootstrapFinished(state) {
      state.bootstrapping = false;
    },
  },
});

export const { sessionStarted, userUpdated, tokenRefreshed, sessionEnded, bootstrapFinished } = authSlice.actions;
export const authReducer = authSlice.reducer;

export const hasPermission = (user: CurrentUserDto | null, perm: Permission) => !!user?.permissions.includes(perm);
export const isAdminUser = (user: CurrentUserDto | null) =>
  !!user && (user.permissions.includes('resource:manage') || user.permissions.includes('user:manage') || user.permissions.includes('analytics:read'));
