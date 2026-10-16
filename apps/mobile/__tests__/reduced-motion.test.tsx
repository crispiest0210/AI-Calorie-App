import { AccessibilityInfo } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type Listener = (value: boolean) => void;

describe('useReducedMotion', () => {
  let listener: Listener | undefined;
  const remove = jest.fn();

  function mockSetting(promise: Promise<boolean>) {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(promise);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
      _event: string,
      handler: Listener,
    ) => {
      listener = handler;
      return { remove };
    }) as unknown as typeof AccessibilityInfo.addEventListener);
  }

  beforeEach(() => {
    listener = undefined;
    remove.mockClear();
  });

  afterEach(() => jest.restoreAllMocks());

  it('starts false, then adopts the system setting', async () => {
    mockSetting(Promise.resolve(true));
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    await act(async () => undefined);
    expect(result.current).toBe(true);
  });

  it('follows later changes to the setting', async () => {
    mockSetting(Promise.resolve(false));
    const { result } = renderHook(() => useReducedMotion());
    await act(async () => undefined);
    act(() => listener?.(true));
    expect(result.current).toBe(true);
    act(() => listener?.(false));
    expect(result.current).toBe(false);
  });

  it('unsubscribes on unmount and ignores a lookup that resolves afterwards', async () => {
    let resolve: (value: boolean) => void = () => undefined;
    mockSetting(new Promise<boolean>((r) => (resolve = r)));
    const { result, unmount } = renderHook(() => useReducedMotion());
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
    await act(async () => resolve(true));
    expect(result.current).toBe(false);
  });
});
