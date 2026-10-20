/**
 * Sign-in screen: the email stage needs an '@', the code stage strips non-digits
 * and needs six, a successful verify signs in and goes back, and failures surface
 * as an AuthError message or a generic fallback.
 */
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockBack = jest.fn();
const mockSignIn = jest.fn();
const mockRequestCode = jest.fn();
const mockVerifyCode = jest.fn();
let mockAccountsEnabled = true;

jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock('@/auth/provider', () => ({ useSession: () => ({ signIn: mockSignIn }) }));
jest.mock('@/config', () => ({
  get accountsEnabled() {
    return mockAccountsEnabled;
  },
}));
jest.mock('@/auth/supabase', () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requestEmailCode: (...args: unknown[]) => mockRequestCode(...args),
    verifyEmailCode: (...args: unknown[]) => mockVerifyCode(...args),
  };
});

import SignInScreen from '../app/sign-in';
import { AuthError } from '@/auth/supabase';

const metrics = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function render() {
  return rtlRender(
    <SafeAreaProvider initialMetrics={metrics}>
      <SignInScreen />
    </SafeAreaProvider>,
  );
}

async function reachCodeStage() {
  fireEvent.changeText(screen.getByLabelText('Email'), ' me@example.com ');
  fireEvent.press(screen.getByRole('button', { name: 'Email me a code' }));
  await screen.findByText('We sent a six-digit code to me@example.com.');
}

describe('SignInScreen', () => {
  beforeEach(() => {
    mockBack.mockClear();
    mockSignIn.mockReset();
    mockRequestCode.mockReset().mockResolvedValue(undefined);
    mockVerifyCode.mockReset();
    mockAccountsEnabled = true;
  });

  it('explains when accounts are not configured', () => {
    mockAccountsEnabled = false;
    render();
    expect(screen.getByText('Accounts are not configured')).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('keeps the send button disabled until the email has an @', () => {
    render();
    const button = () => screen.getByRole('button', { name: 'Email me a code' });
    expect(button().props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText('Email'), 'me@example.com');
    expect(button().props.accessibilityState?.disabled).toBeFalsy();
  });

  it('requests a trimmed email code and moves to the code stage', async () => {
    render();
    await reachCodeStage();
    expect(mockRequestCode).toHaveBeenCalledWith('me@example.com');
  });

  it('strips non-digits and needs six before signing in, then signs in and goes back', async () => {
    mockVerifyCode.mockResolvedValue({ token: 't' });
    render();
    await reachCodeStage();
    const button = () => screen.getByRole('button', { name: 'Sign in' });
    fireEvent.changeText(screen.getByLabelText('Code'), '12a3-4');
    expect(screen.getByLabelText('Code').props.value).toBe('1234');
    expect(button().props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText('Code'), '123456');
    fireEvent.press(button());
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(mockVerifyCode).toHaveBeenCalledWith('me@example.com', '123456');
    expect(mockSignIn).toHaveBeenCalledWith({ token: 't' });
  });

  it('shows an AuthError message and stays on the screen', async () => {
    mockVerifyCode.mockRejectedValue(new AuthError('That code has expired.'));
    render();
    await reachCodeStage();
    fireEvent.changeText(screen.getByLabelText('Code'), '123456');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('That code has expired.')).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('falls back to a generic message for unexpected errors', async () => {
    mockRequestCode.mockRejectedValue(new Error('boom'));
    render();
    fireEvent.changeText(screen.getByLabelText('Email'), 'me@example.com');
    fireEvent.press(screen.getByRole('button', { name: 'Email me a code' }));
    expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
  });

  it('returns to the email stage and clears the code', async () => {
    render();
    await reachCodeStage();
    fireEvent.changeText(screen.getByLabelText('Code'), '123456');
    fireEvent.press(screen.getByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.queryByLabelText('Code')).toBeNull();
  });

  it('lets the user back out without an account', () => {
    render();
    fireEvent.press(screen.getByRole('button', { name: 'Keep using it without an account' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
