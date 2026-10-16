/**
 * The sync badge words (spec 2.11): quiet, never alarming, and a server
 * message wins as the screen-reader label when there is one.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SyncBadge } from '@/components/SyncBadge';
import { useSync, type SyncStatus } from '@/sync/provider';

jest.mock('@/sync/provider', () => ({ useSync: jest.fn() }));

const status = (over: Partial<SyncStatus>): SyncStatus => ({
  state: 'idle',
  lastSyncedAt: null,
  pending: 0,
  message: null,
  syncNow: async () => {},
  ...over,
});

function show(over: Partial<SyncStatus>, onPress?: () => void) {
  (useSync as jest.Mock).mockReturnValue(status(over));
  render(<SyncBadge onPress={onPress} />);
}

describe('SyncBadge', () => {
  it.each([
    [{ state: 'idle' }, 'Synced'],
    [{ state: 'idle', pending: 3 }, '3 waiting'],
    [{ state: 'syncing' }, 'Syncing…'],
    [{ state: 'offline' }, 'Offline'],
    [{ state: 'offline', pending: 2 }, 'Offline · 2 waiting'],
    [{ state: 'error' }, 'Sync problem'],
    [{ state: 'signed_out' }, 'Not signed in'],
    [{ state: 'signed_out', pending: 4 }, '4 on this device'],
  ] as const)('shows %j as "%s"', (over, label) => {
    show(over);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('prefers the server message as the accessibility label', () => {
    show({ state: 'error', message: 'Session expired' });
    expect(screen.getByLabelText('Session expired')).toBeTruthy();
    expect(screen.getByText('Sync problem')).toBeTruthy();
  });

  it('is not a button without onPress', () => {
    show({});
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    show({}, onPress);
    fireEvent.press(screen.getByRole('button', { name: 'Synced' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
