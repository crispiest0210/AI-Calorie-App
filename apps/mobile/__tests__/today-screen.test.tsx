/**
 * Today tab: shows the selected day with date navigation, clamps a stale
 * future date back to today on focus, and seeds the pending meal slot from the
 * time of day.
 */
import { act, render, screen } from '@testing-library/react-native';
import { localDateOf } from '@nt/core';
import { useUiStore } from '@/state/ui';

const mockDayView = jest.fn();
let mockFocusCallback: (() => void) | undefined;

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    mockFocusCallback = cb;
  },
}));
jest.mock('@/components/DayView', () => ({
  DayView: (props: { date: string; showDateNav?: boolean }) => {
    mockDayView(props);
    return null;
  },
}));

import TodayScreen from '../app/(tabs)/index';

describe('TodayScreen', () => {
  beforeEach(() => {
    mockDayView.mockClear();
    mockFocusCallback = undefined;
    act(() => {
      useUiStore.setState({ selectedDate: localDateOf(), pendingMealSlot: 'breakfast' });
    });
  });

  it('renders the selected day with date navigation', () => {
    act(() => useUiStore.setState({ selectedDate: '2026-01-02' }));
    render(<TodayScreen />);
    expect(mockDayView).toHaveBeenLastCalledWith({ date: '2026-01-02', showDateNav: true });
    expect(screen.toJSON()).toBeNull();
  });

  it('pulls a future selected date back to today on focus', () => {
    act(() => useUiStore.setState({ selectedDate: '2999-01-01' }));
    render(<TodayScreen />);
    act(() => mockFocusCallback?.());
    expect(useUiStore.getState().selectedDate).toBe(localDateOf());
  });

  it('leaves a past selected date alone on focus', () => {
    act(() => useUiStore.setState({ selectedDate: '2020-05-05' }));
    render(<TodayScreen />);
    act(() => mockFocusCallback?.());
    expect(useUiStore.getState().selectedDate).toBe('2020-05-05');
  });

  it('seeds the pending meal slot from the time of day', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 15, 12, 30));
    try {
      render(<TodayScreen />);
      expect(useUiStore.getState().pendingMealSlot).toBe('lunch');
    } finally {
      jest.useRealTimers();
    }
  });
});
