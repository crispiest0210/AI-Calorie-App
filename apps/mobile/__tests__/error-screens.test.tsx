/**
 * A screen that throws while rendering shows a retry instead of taking the app
 * down, and a database that will not open says so rather than spinning or
 * crashing — and can be tried again.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockRunMigrations = jest.fn();
const mockClose = jest.fn();

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({ execSync: jest.fn(), getAllSync: jest.fn(() => []), closeSync: mockClose }),
  addDatabaseChangeListener: () => ({ remove: jest.fn() }),
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
  runMigrations: (...args: unknown[]) => mockRunMigrations(...args),
  schema: {},
  water: { ensureDefaultPresets: jest.fn() },
}));

import { DatabaseProvider } from '@/db/provider';
import { ErrorPanel, RouteErrorBoundary } from '@/components/RouteErrorBoundary';

/** Stands in for the error boundary above the provider. */
class Catch extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error === null ? this.props.children : <Text>caught: {this.state.error.message}</Text>;
  }
}

describe('route error boundary', () => {
  it('explains the problem and retries', () => {
    const retry = jest.fn().mockResolvedValue(undefined);
    render(<RouteErrorBoundary error={new Error('boom')} retry={retry} />);
    expect(screen.getByText('This screen hit a problem')).toBeTruthy();
    expect(screen.getByText(/Nothing you logged has been lost/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Try again'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows the error message only in development builds', () => {
    render(<ErrorPanel title="t" body="b" error={new Error('detail for developers')} onRetry={jest.fn()} />);
    expect(screen.queryByText('detail for developers') !== null).toBe(__DEV__);
  });
});

describe('database that will not open', () => {
  beforeEach(() => {
    mockRunMigrations.mockReset();
    mockClose.mockReset();
  });

  const tree = () => (
    <DatabaseProvider
      fallback={<Text>loading</Text>}
      errorFallback={(error, retry) => <ErrorPanel title="Your log could not be opened" body="b" error={error} onRetry={retry} />}
    >
      <Text>opened</Text>
    </DatabaseProvider>
  );

  it('shows an error screen, closes the half-open handle, and opens on retry', async () => {
    mockRunMigrations.mockImplementationOnce(() => {
      throw new Error('migration 0003 failed');
    });
    render(tree());
    await waitFor(() => expect(screen.getByText('Your log could not be opened')).toBeTruthy());
    expect(mockClose).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText('Try again'));
    await waitFor(() => expect(screen.getByText('opened')).toBeTruthy());
    expect(mockRunMigrations).toHaveBeenCalledTimes(2);
  });

  it('still throws to the nearest boundary when no error screen is given', async () => {
    mockRunMigrations.mockImplementation(() => {
      throw new Error('migration 0003 failed');
    });
    // React logs the caught render error; keep the test output quiet.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <Catch>
        <DatabaseProvider fallback={<Text>loading</Text>}>
          <Text>opened</Text>
        </DatabaseProvider>
      </Catch>,
    );
    await waitFor(() => expect(screen.getByText('caught: migration 0003 failed')).toBeTruthy());
    spy.mockRestore();
  });
});

