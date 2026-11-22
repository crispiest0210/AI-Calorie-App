/**
 * useReducedMotion follows the system Reduce Motion setting: it reads the
 * current value, tracks changes, and stops listening on unmount (spec 5.5).
 */
import { AccessibilityInfo } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type Listener = (value: boolean) => void;

function mockSystem(initial: Promise<boolean>) {
  let listener: Listener | undefined;
  const remove = jest.fn();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(initial);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((_event: string, handler: Listener) => {
    listener = handler;
    return { remove };
  }) as never);
  return { remove, emit: (value: boolean) => listener?.(value) };
}

describe('useReducedMotion', () => {
  afterEach(() => jest.restoreAllMocks());

  it('starts false, then reflects the system setting once read', async () => {
    mockSystem(Promise.resolve(true));
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    await act(async () => undefined);
    expect(result.current).toBe(true);
  });

  it('follows later changes to the setting', async () => {
    const system = mockSystem(Promise.resolve(false));
    const { result } = renderHook(() => useReducedMotion());
    await act(async () => undefined);
    act(() => system.emit(true));
    expect(result.current).toBe(true);
    act(() => system.emit(false));
    expect(result.current).toBe(false);
  });

  it('stops listening on unmount and ignores a read that resolves afterwards', async () => {
    let resolve: (value: boolean) => void = () => undefined;
    const system = mockSystem(new Promise<boolean>((r) => (resolve = r)));
    const { result, unmount } = renderHook(() => useReducedMotion());
    unmount();
    expect(system.remove).toHaveBeenCalledTimes(1);
    await act(async () => resolve(true));
    expect(result.current).toBe(false);
  });
});
