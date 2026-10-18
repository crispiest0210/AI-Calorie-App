/**
 * DayHeader shows the day label, steps one day back or forward, and disables
 * the forward arrow when the future is not walkable.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { LocalDate } from '@nt/core';
import { DayHeader } from '@/components/DayHeader';

const date = '2026-03-01' as LocalDate;

describe('DayHeader', () => {
  it('shows the label between the two arrows', () => {
    render(<DayHeader date={date} label="Today" onChange={() => {}} canGoForward />);
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeTruthy();
  });

  it('steps one day back and one day forward', () => {
    const onChange = jest.fn();
    render(<DayHeader date={date} label="Today" onChange={onChange} canGoForward />);
    fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    fireEvent.press(screen.getByRole('button', { name: 'Next day' }));
    expect(onChange).toHaveBeenNthCalledWith(1, '2026-02-28');
    expect(onChange).toHaveBeenNthCalledWith(2, '2026-03-02');
  });

  it('disables the forward arrow when it cannot go forward, but not the back arrow', () => {
    const onChange = jest.fn();
    render(<DayHeader date={date} label="Today" onChange={onChange} canGoForward={false} />);
    const next = screen.getByRole('button', { name: 'Next day' });
    expect(next.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(next);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Previous day' }).props.accessibilityState).toMatchObject({ disabled: false });
  });
});
