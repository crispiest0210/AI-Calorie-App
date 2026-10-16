import { act, renderHook } from '@testing-library/react-native';
import { useDebounced } from '@/hooks/useDebounced';

describe('useDebounced', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebounced('apple', 150));
    expect(result.current).toBe('apple');
  });

  it('adopts a new value only after the delay', () => {
    const { result, rerender } = renderHook(({ value }: { value: string }) => useDebounced(value, 150), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'ap' });
    act(() => void jest.advanceTimersByTime(149));
    expect(result.current).toBe('a');
    act(() => void jest.advanceTimersByTime(1));
    expect(result.current).toBe('ap');
  });

  it('restarts the wait on every change and skips intermediate values', () => {
    const { result, rerender } = renderHook(({ value }: { value: string }) => useDebounced(value, 150), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'ap' });
    act(() => void jest.advanceTimersByTime(100));
    rerender({ value: 'app' });
    act(() => void jest.advanceTimersByTime(100));
    expect(result.current).toBe('a');
    act(() => void jest.advanceTimersByTime(50));
    expect(result.current).toBe('app');
  });

  it('does not update after unmount', () => {
    const clear = jest.spyOn(globalThis, 'clearTimeout');
    const { rerender, unmount } = renderHook(({ value }: { value: string }) => useDebounced(value, 150), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'ap' });
    unmount();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});
