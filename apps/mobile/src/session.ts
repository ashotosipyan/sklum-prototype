import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { uuidv7 } from '@sklum/events';
import { api } from './api';
import { getCustomerId, rotateAnonymousId, setCustomerId } from './storage';
import type { AppThunk } from './store';
import { tracker } from './tracking';

type SessionState = { customerId: string | null };

const initialState: SessionState = { customerId: getCustomerId() ?? null };

const slice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    signedIn: (state, action: PayloadAction<string>) => {
      state.customerId = action.payload;
    },
    signedOut: (state) => {
      state.customerId = null;
    },
  },
});

export const sessionReducer = slice.reducer;

/**
 * Side effects live in thunks, never reducers. Order matters: the identity link
 * is emitted from the anonymous identity before anything carries the customer id.
 */
export const signIn =
  (customerId: string): AppThunk =>
  (dispatch) => {
    setCustomerId(customerId);
    tracker.identify(customerId);
    dispatch(slice.actions.signedIn(customerId));
    dispatch(api.util.invalidateTags(['Feed']));
    void tracker.flush({ ignoreBackoff: true });
  };

/**
 * Events already queued keep the identity they were created with — envelopes are
 * immutable once built — so rotating the anonymous id here cannot misattribute
 * anything still waiting to be sent.
 */
export const signOut = (): AppThunk => (dispatch) => {
  setCustomerId(null);
  tracker.resetIdentity(rotateAnonymousId(uuidv7));
  dispatch(slice.actions.signedOut());
  dispatch(api.util.invalidateTags(['Feed']));
};
