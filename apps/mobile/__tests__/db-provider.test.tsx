/**
 * First launch seeds the local database from the bundled catalog, and the hooks
 * refuse to run without a provider. A failed copy has to surface as an error
 * rather than leave the app on the loading fallback forever.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockState = { targetExists: false, localUri: 'file:///bundle/catalog.sqlite' as string | null };
const mockCopy = jest.fn();
const mockCreateDirectory = jest.fn();

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({ execSync: jest.fn(), getAllSync: jest.fn(() => []) }),
  addDatabaseChangeListener: () => ({ remove: jest.fn() }),
}));

jest.mock('expo-asset', () => ({
  Asset: { fromModule: () => ({ downloadAsync: jest.fn().mockResolvedValue(undefined), get localUri() { return mockState.localUri; } }) },
}));

jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents' },
  Directory: class {
    exists = false;
    create(options: unknown) {
      mockCreateDirectory(options);
    }
  },
  File: class {
    get exists() {
      return mockState.targetExists;
    }
    copy(target: unknown) {
      mockCopy(target);
    }
  },
}));

// Jest has no transformer for the bundled .sqlite asset; the provider only passes it to Asset.
jest.mock('../assets/catalog.sqlite', () => 1, { virtual: true });

jest.mock('drizzle-orm/expo-sqlite', () => ({ drizzle: () => ({ marker: 'db' }) }));

jest.mock('@nt/db', () => ({
  applyPragmas: jest.fn(),
  runMigrations: jest.fn(),
  schema: {},
  water: { ensureDefaultPresets: jest.fn() },
}));

import { DatabaseProvider, useDb, useDbQuery } from '@/db/provider';

function Probe() {
  const db = useDb();
  return <Text testID="db">{(db as unknown as { marker: string }).marker}</Text>;
}

function renderProvider() {
  return render(
    <DatabaseProvider fallback={<Text>loading</Text>}>
      <Probe />
    </DatabaseProvider>,
  );
}

describe('DatabaseProvider first launch', () => {
  beforeEach(() => {
    mockState.targetExists = false;
    mockState.localUri = 'file:///bundle/catalog.sqlite';
    mockCopy.mockClear();
    mockCreateDirectory.mockClear();
  });

  it('shows the fallback, then copies the bundled catalog into a new SQLite directory', async () => {
    renderProvider();
    expect(screen.getByText('loading')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('db')).toHaveTextContent('db'));
    expect(mockCreateDirectory).toHaveBeenCalledWith({ intermediates: true });
    expect(mockCopy).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite an existing database file', async () => {
    mockState.targetExists = true;
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('db')).toBeTruthy());
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('surfaces a missing bundled catalog file as an error instead of loading forever', async () => {
    mockState.localUri = null;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    class Boundary extends React.Component<{ children: React.ReactNode }, { message: string | null }> {
      state = { message: null as string | null };
      static getDerivedStateFromError(error: Error) {
        return { message: error.message };
      }
      render() {
        return this.state.message === null ? this.props.children : <Text testID="error">{this.state.message}</Text>;
      }
    }
    render(
      <Boundary>
        <DatabaseProvider fallback={<Text>loading</Text>}>
          <Probe />
        </DatabaseProvider>
      </Boundary>,
    );
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('bundled catalog asset is missing'));
    expect(mockCopy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });
});

describe('database hooks outside the provider', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('useDb throws a descriptive error', () => {
    expect(() => render(<Probe />)).toThrow('useDb must be used inside DatabaseProvider');
  });

  it('useDbQuery throws a descriptive error', () => {
    function Query() {
      useDbQuery(() => 1);
      return null;
    }
    expect(() => render(<Query />)).toThrow('useDbQuery must be used inside DatabaseProvider');
  });
});
