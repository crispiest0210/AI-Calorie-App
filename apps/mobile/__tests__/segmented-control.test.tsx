/**
 * SegmentedControl is a radiogroup: exactly the current value is selected,
 * and pressing an option reports its value.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SegmentedControl } from '@/components/SegmentedControl';

const options = [
  { value: 'g', label: 'Grams' },
  { value: 'oz', label: 'Ounces' },
] as const;

describe('SegmentedControl', () => {
  it('exposes a labelled radiogroup with one radio per option', () => {
    render(<SegmentedControl label="Unit" options={options} value="g" onChange={() => {}} />);
    expect(screen.getByLabelText('Unit')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('marks only the current value as selected', () => {
    render(<SegmentedControl label="Unit" options={options} value="oz" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Grams' }).props.accessibilityState).toEqual({ selected: false });
    expect(screen.getByRole('radio', { name: 'Ounces' }).props.accessibilityState).toEqual({ selected: true });
  });

  it('reports the pressed option value', () => {
    const onChange = jest.fn();
    render(<SegmentedControl label="Unit" options={options} value="g" onChange={onChange} />);
    fireEvent.press(screen.getByRole('radio', { name: 'Ounces' }));
    expect(onChange).toHaveBeenCalledWith('oz');
  });
});
