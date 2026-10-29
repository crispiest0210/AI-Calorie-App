/**
 * Button speaks its label by default, lets an explicit accessibility label
 * win, and never fires onPress while disabled.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { Button, Row } from '@/components/Button';

describe('Button', () => {
  it('is a button named by its label and fires onPress', () => {
    const onPress = jest.fn();
    render(<Button label="Save" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('prefers an explicit accessibility label over the visible label', () => {
    render(<Button label="Add" accessibilityLabel="Add lunch entry" accessibilityHint="Opens the food picker" onPress={() => {}} />);
    const button = screen.getByRole('button', { name: 'Add lunch entry' });
    expect(button.props.accessibilityHint).toBe('Opens the food picker');
    expect(screen.getByText('Add')).toBeTruthy();
  });

  it('reports the disabled state and ignores presses', () => {
    const onPress = jest.fn();
    render(<Button label="Save" disabled onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.props.accessibilityState).toEqual({ disabled: true });
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('is enabled by default', () => {
    render(<Button label="Save" onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityState).toEqual({ disabled: false });
  });
});

describe('Row', () => {
  it('lays children out horizontally with the default gap', () => {
    render(<Row><Text>One</Text></Row>);
    const row = StyleSheet.flatten(screen.getByText('One').parent!.parent!.props.style);
    expect(row).toMatchObject({ flexDirection: 'row', alignItems: 'center' });
    expect(row.gap).toBeGreaterThan(0);
  });

  it('honours an explicit gap and extra style', () => {
    render(<Row gap={3} style={{ marginTop: 2 }}><Text>One</Text></Row>);
    const row = StyleSheet.flatten(screen.getByText('One').parent!.parent!.props.style);
    expect(row).toMatchObject({ flexDirection: 'row', gap: 3, marginTop: 2 });
  });
});
