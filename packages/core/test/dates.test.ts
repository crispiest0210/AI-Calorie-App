import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, formatDayLabel, formatTimeOfDay, isLocalDate, lastNDays, localDateOf, tzOffsetMinutesOf } from '../src/dates';

describe('local dates', () => {
  it('validates YYYY-MM-DD', () => {
    expect(isLocalDate('2026-09-20')).toBe(true);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-9-20')).toBe(false);
    expect(isLocalDate('nope')).toBe(false);
  });

  it('reads the device calendar date and offset', () => {
    const instant = new Date(2026, 8, 20, 13, 45);
    expect(localDateOf(instant)).toBe('2026-09-20');
    expect(tzOffsetMinutesOf(instant)).toBe(-instant.getTimezoneOffset());
    expect(localDateOf()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof tzOffsetMinutesOf()).toBe('number');
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-09-13', '2026-09-20')).toBe(7);
    expect(daysBetween('2026-09-20', '2026-09-13')).toBe(-7);
  });

  it('builds trend windows oldest first', () => {
    expect(lastNDays('2026-09-20', 3)).toEqual(['2026-09-18', '2026-09-19', '2026-09-20']);
  });

  it('labels days the way the header does', () => {
    expect(formatDayLabel('2026-09-20', '2026-09-20')).toBe('Today');
    expect(formatDayLabel('2026-09-19', '2026-09-20')).toBe('Yesterday');
    expect(formatDayLabel('2026-09-21', '2026-09-20')).toBe('Tomorrow');
    expect(formatDayLabel('2026-09-14', '2026-09-20')).toBe('Mon, Sep 14');
  });

  it('formats clock times', () => {
    expect(formatTimeOfDay(new Date(2026, 8, 20, 0, 5).getTime())).toBe('12:05 AM');
    expect(formatTimeOfDay(new Date(2026, 8, 20, 12, 0).getTime())).toBe('12:00 PM');
    expect(formatTimeOfDay(new Date(2026, 8, 20, 13, 7).getTime())).toBe('1:07 PM');
  });
});
