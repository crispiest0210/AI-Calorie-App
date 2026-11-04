/**
 * NumberField: the stepper buttons and screen-reader actions nudge the value
 * (never below zero), and malformed typed text is refused.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { NumberField } from '@/components/NumberField';

describe('NumberField', () => {
  it('steps up and down by the configured step', () => {
    const onChange = jest.fn();
    render(<NumberField value="100" onChange={onChange} label="Amount" step={25} />);
    fireEvent.press(screen.getByRole('button', { name: 'Increase by 25' }));
    expect(onChange).toHaveBeenLastCalledWith('125', '125');
    fireEvent.press(screen.getByRole('button', { name: 'Decrease by 25' }));
    expect(onChange).toHaveBeenLastCalledWith('75', '75');
  });

  it('never steps below zero and treats an empty value as zero', () => {
    const onChange = jest.fn();
    const { rerender } = render(<NumberField value="5" onChange={onChange} label="Amount" />);
    fireEvent.press(screen.getByRole('button', { name: 'Decrease by 10' }));
    expect(onChange).toHaveBeenLastCalledWith('0', '0');
    rerender(<NumberField value="" onChange={onChange} label="Amount" />);
    fireEvent.press(screen.getByRole('button', { name: 'Increase by 10' }));
    expect(onChange).toHaveBeenLastCalledWith('10', '10');
  });

  it('refuses malformed pasted text', () => {
    const onChange = jest.fn();
    render(<NumberField value="" onChange={onChange} label="Amount" />);
    fireEvent.changeText(screen.getByLabelText('Amount'), '1.2.x3');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('supports increment and decrement accessibility actions', () => {
    const onChange = jest.fn();
    render(<NumberField value="40" onChange={onChange} label="Amount" />);
    const input = screen.getByLabelText('Amount');
    fireEvent(input, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).toHaveBeenLastCalledWith('50', '50');
    fireEvent(input, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onChange).toHaveBeenLastCalledWith('30', '30');
  });
});
