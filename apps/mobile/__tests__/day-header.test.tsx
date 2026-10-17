/**
 * DayHeader steps one day back or forward; the future arrow is disabled when
 * there is nothing to walk to.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DayHeader } from '@/components/DayHeader';

describe('DayHeader', () => {
  it('shows the day label', () => {
    render(<DayHeader date="2026-03-10" label="Today" onChange={jest.fn()} canGoForward />);
    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('steps back one day', () => {
    const onChange = jest.fn();
    render(<DayHeader date="2026-03-01" label="Sun" onChange={onChange} canGoForward />);
    fireEvent.press(screen.getByLabelText('Previous day'));
    expect(onChange).toHaveBeenCalledWith('2026-02-28');
  });

  it('steps forward one day when allowed', () => {
    const onChange = jest.fn();
    render(<DayHeader date="2026-03-10" label="Tue" onChange={onChange} canGoForward />);
    fireEvent.press(screen.getByLabelText('Next day'));
    expect(onChange).toHaveBeenCalledWith('2026-03-11');
  });

  it('disables the next arrow and ignores presses when the future is closed', () => {
    const onChange = jest.fn();
    render(<DayHeader date="2026-03-10" label="Today" onChange={onChange} canGoForward={false} />);
    const next = screen.getByLabelText('Next day');
    expect(next.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(next);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Previous day').props.accessibilityState).toMatchObject({ disabled: false });
  });
});
