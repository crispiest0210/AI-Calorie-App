/**
 * NumberField: the stepper buttons and screen-reader actions nudge the value
 * (never below zero), and typed text is sanitised to a single decimal number.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { NumberField, sanitizeDecimalInput } from '@/components/NumberField';

describe('sanitizeDecimalInput', () => {
  it('strips non-numeric characters and keeps only the first decimal point', () => {
    expect(sanitizeDecimalInput('1a2')).toBe('12');
    expect(sanitizeDecimalInput('1.2.3')).toBe('1.23');
    expect(sanitizeDecimalInput('-5,0')).toBe('50');
    expect(sanitizeDecimalInput('.5')).toBe('.5');
  });
});

describe('NumberField', () => {
  it('steps up and down by the configured step', () => {
    const onChange = jest.fn();
    render(<NumberField value="100" onChange={onChange} label="Amount" step={25} />);
    fireEvent.press(screen.getByRole('button', { name: 'Increase by 25' }));
    expect(onChange).toHaveBeenLastCalledWith('125');
    fireEvent.press(screen.getByRole('button', { name: 'Decrease by 25' }));
    expect(onChange).toHaveBeenLastCalledWith('75');
  });

  it('never steps below zero and treats an empty value as zero', () => {
    const onChange = jest.fn();
    const { rerender } = render(<NumberField value="5" onChange={onChange} label="Amount" />);
    fireEvent.press(screen.getByRole('button', { name: 'Decrease by 10' }));
    expect(onChange).toHaveBeenLastCalledWith('0');
    rerender(<NumberField value="" onChange={onChange} label="Amount" />);
    fireEvent.press(screen.getByRole('button', { name: 'Increase by 10' }));
    expect(onChange).toHaveBeenLastCalledWith('10');
  });

  it('sanitises typed text before reporting it', () => {
    const onChange = jest.fn();
    render(<NumberField value="" onChange={onChange} label="Amount" />);
    fireEvent.changeText(screen.getByLabelText('Amount'), '1.2.x3');
    expect(onChange).toHaveBeenCalledWith('1.23');
  });

  it('supports increment and decrement accessibility actions', () => {
    const onChange = jest.fn();
    render(<NumberField value="40" onChange={onChange} label="Amount" />);
    const input = screen.getByLabelText('Amount');
    fireEvent(input, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).toHaveBeenLastCalledWith('50');
    fireEvent(input, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onChange).toHaveBeenLastCalledWith('30');
  });
});
