import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { FeedItem } from './api';
import { readSavedIds, writeSavedIds } from './storage';
import type { AppThunk } from './store';
import { tracker } from './tracking';

/**
 * Saved state is local in the prototype. In production it belongs to the
 * account service so it follows the customer across devices — noted in
 * PRODUCTION-DELTA.md. The event, however, is already exactly what production
 * would emit.
 */
const slice = createSlice({
  name: 'saved',
  initialState: { ids: readSavedIds() },
  reducers: {
    toggled: (state, action: PayloadAction<string>) => {
      if (state.ids[action.payload]) delete state.ids[action.payload];
      else state.ids[action.payload] = true;
    },
  },
});

export const savedReducer = slice.reducer;

export const toggleSave =
  (item: FeedItem, feedRequestId: string | undefined): AppThunk =>
  (dispatch, getState) => {
    const wasSaved = Boolean(getState().saved.ids[item.id]);
    const category = item.category ?? 'uncategorised';

    // One tap is one user action is one event, with its own id. A double tap is
    // two actions and correctly produces two events; a retried send of either is
    // deduplicated server-side by event_id.
    tracker.track(
      wasSaved ? 'item_unsaved' : 'item_saved',
      { item_id: item.id, category },
      { surface: 'home', feed_request_id: feedRequestId },
    );

    dispatch(slice.actions.toggled(item.id));
    writeSavedIds(getState().saved.ids);
  };
