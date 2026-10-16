import * as Haptics from 'expo-haptics';
import { successFeedback, tapFeedback } from '@/hooks/useHaptics';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));

const impactAsync = Haptics.impactAsync as jest.Mock;
const notificationAsync = Haptics.notificationAsync as jest.Mock;

describe('haptics feedback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('tapFeedback fires a light impact', () => {
    impactAsync.mockResolvedValue(undefined);
    tapFeedback();
    expect(impactAsync).toHaveBeenCalledWith('light');
  });

  it('successFeedback fires a success notification', () => {
    notificationAsync.mockResolvedValue(undefined);
    successFeedback();
    expect(notificationAsync).toHaveBeenCalledWith('success');
  });

  it('swallows haptics failures on devices without a haptic engine', async () => {
    impactAsync.mockRejectedValue(new Error('unsupported'));
    notificationAsync.mockRejectedValue(new Error('unsupported'));
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    expect(() => {
      tapFeedback();
      successFeedback();
    }).not.toThrow();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
