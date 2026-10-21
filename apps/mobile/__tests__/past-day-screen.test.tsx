/**
 * Past-day screen: a valid `date` route param opens that day, anything else
 * (missing, malformed, repeated) falls back to today instead of crashing.
 */
import { render } from '@testing-library/react-native';
import { localDateOf } from '@nt/core';

let mockParams: { date?: string | string[] } = {};
const mockDayView = jest.fn((_props: unknown) => null);

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('@/components/DayView', () => ({
  DayView: (props: unknown) => mockDayView(props),
}));

import PastDayScreen from '../app/day/[date]';

describe('PastDayScreen', () => {
  beforeEach(() => {
    mockDayView.mockClear();
    mockParams = {};
  });

  it('opens the requested day without the date navigator', () => {
    mockParams = { date: '2024-03-09' };
    render(<PastDayScreen />);
    expect(mockDayView).toHaveBeenCalledWith({ date: '2024-03-09', showDateNav: false });
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'yesterday'],
    ['impossible', '2024-02-31'],
    ['repeated', ['2024-03-09', '2024-03-10']],
  ])('falls back to today when the date is %s', (_label, date) => {
    mockParams = { date };
    render(<PastDayScreen />);
    expect(mockDayView).toHaveBeenCalledWith({ date: localDateOf(), showDateNav: false });
  });
});
