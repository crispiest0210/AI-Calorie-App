/**
 * SQLite is the single source of truth, so every screen depends on the change
 * listener actually firing. Two things have to be right for that: the database
 * must be opened with `enableChangeListener`, and the event filter must match
 * how expo-sqlite names the database. Both were wrong once; this pins them.
 */
import { render, screen, act, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockListeners: ((event: Record<string, unknown>) => void)[] = [];
const mockOpenDatabaseSync = jest.fn(() => ({ execSync: jest.fn(), getAllSync: jest.fn(() => []) }));

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: (...args: unknown[]) => mockOpenDatabaseSync(...(args as [])),
  addDatabaseChangeListener: (listener: (event: Record<string, unknown>) => void) => {
    mockListeners.push(listener);
    return { remove: jest.fn() };
  },
}));

jest.mock('expo-asset', () => ({
  Asset: { fromModule: () => ({ downloadAsync: jest.fn().mockResolvedValue(undefined), localUri: 'file:///bundle/catalog.sqlite' }) },
}));

jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents' },
  Directory: class {
    exists = true;
    create() {}
  },
  File: class {
    exists = true;
    copy() {}
  },
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({ drizzle: () => ({ marker: 'db' }) }));

jest.mock('@nt/db', () => ({
  applyPragmas: jest.fn(),
  runMigrations: jest.fn(),
  schema: {},
  water: { ensureDefaultPresets: jest.fn() },
}));

import { DatabaseProvider, useDbQuery } from '@/db/provider';

let reads = 0;

function Probe() {
  const value = useDbQuery(() => {
    reads += 1;
    return reads;
  }, []);
  return <Text testID="reads">{String(value)}</Text>;
}

function emitChange(event: Record<string, unknown>) {
  act(() => {
    for (const listener of mockListeners) listener(event);
  });
}

describe('database reactivity', () => {
  beforeEach(() => {
    reads = 0;
    mockListeners.length = 0;
    mockOpenDatabaseSync.mockClear();
  });

  it('opens the database with the change listener enabled', async () => {
    render(
      <DatabaseProvider fallback={<Text>loading</Text>}>
        <Probe />
      </DatabaseProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('reads')).toBeTruthy());
    expect(mockOpenDatabaseSync).toHaveBeenCalledWith('nutrition.db', { enableChangeListener: true });
  });

  it('re-reads when a write fires a change event', async () => {
    render(
      <DatabaseProvider fallback={<Text>loading</Text>}>
        <Probe />
      </DatabaseProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('reads')).toHaveTextContent('1'));

    // expo-sqlite reports SQLite's internal name, "main" — not the file name.
    emitChange({ databaseName: 'main', databaseFilePath: '/var/mobile/Documents/SQLite/nutrition.db', tableName: 'log_entry', rowId: 1 });
    await waitFor(() => expect(screen.getByTestId('reads')).toHaveTextContent('2'));

    emitChange({ databaseName: 'main', databaseFilePath: '/var/mobile/Documents/SQLite/nutrition.db', tableName: 'water_entry', rowId: 2 });
    await waitFor(() => expect(screen.getByTestId('reads')).toHaveTextContent('3'));
  });

  it('ignores changes to a different database file', async () => {
    render(
      <DatabaseProvider fallback={<Text>loading</Text>}>
        <Probe />
      </DatabaseProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('reads')).toHaveTextContent('1'));
    emitChange({ databaseName: 'main', databaseFilePath: '/var/mobile/Documents/SQLite/other.db', tableName: 'x', rowId: 1 });
    expect(screen.getByTestId('reads')).toHaveTextContent('1');
  });
});
