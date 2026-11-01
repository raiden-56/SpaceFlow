// Shared "booking context": the building/floor/date/time window every view (dashboard, explorer,
// seat booking, rooms) reads from, so switching views never loses the selection.
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { dayjs } from '@/utils/time';

export type ViewMode = '3D' | '2D' | 'LIST';

export interface BookingContextState {
  buildingId: string | null;
  floorId: string | null;
  /** YYYY-MM-DD in the building timezone */
  date: string;
  /** HH:mm */
  startTime: string;
  endTime: string;
  allDay: boolean;
  viewMode: ViewMode;
  selectedResourceId: string | null;
  /** Resource to focus the camera on after navigation ("View on map"). */
  focusResourceId: string | null;
  explodedView: boolean;
  /**
   * True when the user explicitly chose "Whole building" (floorId === null on purpose), so the
   * default-floor logic in useBookingWindow must not re-select a floor.
   */
  wholeBuilding: boolean;
}

function defaultTimes() {
  const now = dayjs();
  const startHour = Math.min(Math.max(now.hour() + 1, 8), 17);
  return { startTime: `${String(startHour).padStart(2, '0')}:00`, endTime: '18:00' };
}

const initialState: BookingContextState = {
  buildingId: null,
  floorId: null,
  date: dayjs().format('YYYY-MM-DD'),
  ...defaultTimes(),
  allDay: true,
  viewMode: '3D',
  selectedResourceId: null,
  focusResourceId: null,
  explodedView: false,
  wholeBuilding: false,
};

const bookingSlice = createSlice({
  name: 'booking',
  initialState,
  reducers: {
    setBuilding(state, action: PayloadAction<string | null>) {
      if (state.buildingId !== action.payload) {
        state.floorId = null;
        state.selectedResourceId = null;
        state.wholeBuilding = false;
      }
      state.buildingId = action.payload;
    },
    /** Select a floor, or pass null to explicitly show the whole building. */
    setFloor(state, action: PayloadAction<string | null>) {
      if (state.floorId !== action.payload) state.selectedResourceId = null;
      state.floorId = action.payload;
      state.wholeBuilding = action.payload === null;
    },
    setDate(state, action: PayloadAction<string>) {
      // Ignore partial / invalid input (e.g. while a date is being typed); downstream time
      // conversions throw on invalid dates.
      if (/^\d{4}-\d{2}-\d{2}$/.test(action.payload) && dayjs(action.payload, 'YYYY-MM-DD').isValid()) state.date = action.payload;
    },
    setTimeWindow(state, action: PayloadAction<{ startTime?: string; endTime?: string; allDay?: boolean }>) {
      if (action.payload.startTime) state.startTime = action.payload.startTime;
      if (action.payload.endTime) state.endTime = action.payload.endTime;
      if (action.payload.allDay !== undefined) state.allDay = action.payload.allDay;
    },
    setViewMode(state, action: PayloadAction<ViewMode>) {
      state.viewMode = action.payload;
    },
    selectResource(state, action: PayloadAction<string | null>) {
      state.selectedResourceId = action.payload;
    },
    focusResource(state, action: PayloadAction<{ buildingId: string; floorId: string; resourceId: string }>) {
      state.buildingId = action.payload.buildingId;
      state.floorId = action.payload.floorId;
      state.wholeBuilding = false;
      state.selectedResourceId = action.payload.resourceId;
      state.focusResourceId = action.payload.resourceId;
    },
    clearFocus(state) {
      state.focusResourceId = null;
    },
    setExploded(state, action: PayloadAction<boolean>) {
      state.explodedView = action.payload;
    },
  },
});

export const { setBuilding, setFloor, setDate, setTimeWindow, setViewMode, selectResource, focusResource, clearFocus, setExploded } = bookingSlice.actions;
export const bookingReducer = bookingSlice.reducer;
