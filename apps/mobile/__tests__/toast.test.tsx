/**
 * The undo toast dismisses itself on a fixed clock, even when the parent
 * re-renders with a fresh onDismiss closure (spec 5.2).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';
import { MIN_TOUCH_TARGET } from '@/theme';
import { Toast, type ToastProps } from '@/components/Toast';

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

const toast = (props: ToastProps) => (
  <SafeAreaProvider initialMetrics={metrics}>
    <Toast {...props} />
  </SafeAreaProvider>
);

describe('Toast', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not restart the dismiss timer when onDismiss changes identity', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(toast({ message: 'Deleted', onDismiss: first, durationMs: 5000 }));
    act(() => jest.advanceTimersByTime(3000));
    rerender(toast({ message: 'Deleted', onDismiss: second, durationMs: 5000 }));
    act(() => jest.advanceTimersByTime(2000));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('never dismisses when there is no message', () => {
    const onDismiss = jest.fn();
    render(toast({ message: null, onDismiss }));
    act(() => jest.advanceTimersByTime(10000));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('renders an action button at least the minimum touch target tall and fires onAction', () => {
    const onAction = jest.fn();
    render(toast({ message: 'Deleted', actionLabel: 'Undo', onAction, onDismiss: jest.fn() }));
    const button = screen.getByRole('button', { name: 'Undo' });
    const flat = Object.assign({}, ...[button.props.style].flat(Infinity));
    expect(flat.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    fireEvent.press(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('omits the action button when no action handler is given', () => {
    render(toast({ message: 'Saved', actionLabel: 'Undo', onDismiss: jest.fn() }));
    expect(screen.queryByRole('button')).toBeNull();
  });
});
