/**
 * Component tests (spec 6.1): the parts a screen reader relies on, and the
 * amount stepper's adjustable actions. These are the labels the accessibility
 * checklist is read against before a phase ships.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import { EnergyRing } from '@/components/EnergyRing';
import { MacroBars } from '@/components/MacroBars';
import { NumberField } from '@/components/NumberField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { FoodRow } from '@/components/FoodRow';
import { WaterRow } from '@/components/WaterRow';
import { sumNutrients, resolveTarget, goalProgress } from '@nt/core';

describe('EnergyRing', () => {
  it('describes the ring in words', () => {
    render(<EnergyRing consumed="1420" target="2100" remaining="680" ratio={0.676} incomplete={false} />);
    expect(screen.getByLabelText('Energy: 1,420 of 2,100 cal, 680 remaining')).toBeTruthy();
    expect(screen.getByText('680 cal left')).toBeTruthy();
  });

  it('states an overshoot plainly, without shaming copy', () => {
    render(<EnergyRing consumed="2220" target="2100" remaining="-120" ratio={1.057} incomplete={false} />);
    expect(screen.getByLabelText('Energy: 2,220 of 2,100 cal, 120 over')).toBeTruthy();
    expect(screen.getByText('120 cal over')).toBeTruthy();
  });

  it('says when a total is incomplete rather than implying it is final', () => {
    render(<EnergyRing consumed="300" target={null} remaining={null} ratio={null} incomplete />);
    expect(screen.getByText('incomplete')).toBeTruthy();
    expect(screen.getByLabelText('Energy: 300 cal, no target set')).toBeTruthy();
  });
});

describe('MacroBars', () => {
  it('gives every bar a text alternative', () => {
    const totals = sumNutrients([{ energy_kcal: '1400', protein_g: '80', carb_g: '150', fat_g: '40' }]);
    const target = resolveTarget(
      { nutrientCode: 'protein_g', kind: 'target', value: '120', valueLow: null, valueHigh: null, basis: 'absolute' },
      '2100',
    );
    render(<MacroBars totals={totals} progress={[goalProgress(totals, target)]} />);
    expect(screen.getByLabelText('Protein: 80 of 120 g')).toBeTruthy();
    expect(screen.getByLabelText('Carbs: 150 g, no target set')).toBeTruthy();
  });

  it('marks an over-target macro in words as well as colour', () => {
    const totals = sumNutrients([{ energy_kcal: '1400', protein_g: '200', carb_g: '10', fat_g: '10' }]);
    const target = resolveTarget(
      { nutrientCode: 'protein_g', kind: 'target', value: '120', valueLow: null, valueHigh: null, basis: 'absolute' },
      '2100',
    );
    render(<MacroBars totals={totals} progress={[goalProgress(totals, target)]} />);
    expect(screen.getByLabelText('Protein: 200 of 120 g, over target')).toBeTruthy();
  });
});

describe('NumberField', () => {
  it('exposes increment and decrement without the keyboard', () => {
    const onChange = jest.fn();
    render(<NumberField label="Amount" value="100" onChange={onChange} suffix="grams" step={10} />);
    fireEvent.press(screen.getByLabelText('Increase by 10'));
    expect(onChange).toHaveBeenLastCalledWith('110');
    fireEvent.press(screen.getByLabelText('Decrease by 10'));
    expect(onChange).toHaveBeenLastCalledWith('90');
  });

  it('never steps below zero', () => {
    const onChange = jest.fn();
    render(<NumberField label="Amount" value="5" onChange={onChange} step={10} />);
    fireEvent.press(screen.getByLabelText('Decrease by 10'));
    expect(onChange).toHaveBeenLastCalledWith('0');
  });

  it('keeps the field numeric as the user types', () => {
    const onChange = jest.fn();
    render(<NumberField label="Amount" value="100" onChange={onChange} />);
    fireEvent.changeText(screen.getByLabelText('Amount'), '12a.5x');
    expect(onChange).toHaveBeenLastCalledWith('12.5');
  });
});

describe('SegmentedControl', () => {
  it('announces the selected option', () => {
    const onChange = jest.fn();
    render(
      <SegmentedControl
        label="Unit"
        options={[
          { value: 'g', label: 'grams' },
          { value: 'ml', label: 'mL' },
        ]}
        value="g"
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText('grams').props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(screen.getByLabelText('mL'));
    expect(onChange).toHaveBeenCalledWith('ml');
  });
});

describe('FoodRow', () => {
  it('reads the food, its brand and its energy', () => {
    render(
      <FoodRow
        food={{ id: '1', name: 'Rice, brown, cooked', brand: 'Acme', kind: 'branded', qualityTier: 'label', energyPer100g: '123' }}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByLabelText('Rice, brown, cooked, Acme, 123 calories per 100 grams')).toBeTruthy();
    expect(screen.getByText('Label (USDA)')).toBeTruthy();
  });
});

describe('WaterRow', () => {
  it('labels each quick-add by the amount it adds', () => {
    const onAdd = jest.fn();
    render(
      <WaterRow
        progress={{ consumedMl: 750, targetMl: 2500, remainingMl: 1750, ratio: 0.3 }}
        presets={[{ id: 'p1', label: 'Glass', amountMl: 250 }]}
        onAdd={onAdd}
        onOpen={jest.fn()}
      />,
    );
    expect(screen.getByLabelText('Water: 750 of 2500 millilitres')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Add 250 millilitres of water'));
    expect(onAdd).toHaveBeenCalledWith(250);
  });
});
