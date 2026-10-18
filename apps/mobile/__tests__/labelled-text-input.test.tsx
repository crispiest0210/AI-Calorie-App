/**
 * LabelledTextInput shows its label above the field and also hands it to the
 * input as its accessibility label, forwarding every other TextInput prop.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { LabelledTextInput } from '@/components/LabelledTextInput';

describe('LabelledTextInput', () => {
  it('shows the label and exposes it as the input accessibility label', () => {
    render(<LabelledTextInput label="Food name" value="" onChangeText={() => {}} />);
    expect(screen.getByText('Food name')).toBeTruthy();
    expect(screen.getByLabelText('Food name')).toBeTruthy();
  });

  it('forwards value, placeholder and change events to the input', () => {
    const onChangeText = jest.fn();
    render(<LabelledTextInput label="Brand" value="Acme" placeholder="Optional" onChangeText={onChangeText} />);
    const input = screen.getByLabelText('Brand');
    expect(input.props.value).toBe('Acme');
    expect(input.props.placeholder).toBe('Optional');
    fireEvent.changeText(input, 'Acme Foods');
    expect(onChangeText).toHaveBeenCalledWith('Acme Foods');
  });

  it('lets a caller style be merged after the defaults', () => {
    render(<LabelledTextInput label="Notes" style={{ minHeight: 120 }} />);
    const flat = Object.assign({}, ...[screen.getByLabelText('Notes').props.style].flat(Infinity));
    expect(flat.minHeight).toBe(120);
  });
});
