/**
 * The trend chart's job is to be readable without seeing it: every bar is a
 * labelled target, the chart as a whole states its own summary, and going over
 * target is said in words as well as drawn.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import { TrendChart, type TrendDay } from '@/components/TrendChart';
import { StatTile } from '@/components/StatTile';

const TODAY = '2026-09-21';

const days: TrendDay[] = [
  { date: '2026-09-19', energy: 1800, target: 2100 },
  { date: '2026-09-20', energy: 2400, target: 2100 },
  { date: '2026-09-21', energy: null, target: 2100 },
];

describe('TrendChart', () => {
  it('summarises the whole range in one sentence', () => {
    render(<TrendChart days={days} today={TODAY} onSelectDay={jest.fn()} />);
    expect(
      screen.getByLabelText('Energy over 3 days: 2 logged, averaging 2100 calories a day against a target of 2100.'),
    ).toBeTruthy();
  });

  it('says when a day went over, rather than only colouring it', () => {
    render(<TrendChart days={days} today={TODAY} onSelectDay={jest.fn()} />);
    expect(screen.getByLabelText('Yesterday, 2,400 calories, over target')).toBeTruthy();
    expect(screen.getByLabelText('Sat, Sep 19, 1,800 calories')).toBeTruthy();
    expect(screen.getByText(/Hatched bars went over/)).toBeTruthy();
  });

  it('labels a day with nothing logged as such, not as zero', () => {
    render(<TrendChart days={days} today={TODAY} onSelectDay={jest.fn()} />);
    expect(screen.getByLabelText('Today, nothing logged')).toBeTruthy();
  });

  it('opens the day behind a bar', () => {
    const onSelectDay = jest.fn();
    render(<TrendChart days={days} today={TODAY} onSelectDay={onSelectDay} />);
    fireEvent.press(screen.getByLabelText('Yesterday, 2,400 calories, over target'));
    expect(onSelectDay).toHaveBeenCalledWith('2026-09-20');
  });

  it('copes with a range where nothing is logged and no target is set', () => {
    render(
      <TrendChart
        days={[{ date: '2026-09-21', energy: null, target: null }]}
        today={TODAY}
        onSelectDay={jest.fn()}
      />,
    );
    expect(screen.getByLabelText('No days logged in this range.')).toBeTruthy();
  });
});

describe('StatTile', () => {
  it('reads label, value and target as one phrase', () => {
    render(<StatTile label="Protein" value="104" unit="g" detail="of 131 g target" />);
    expect(screen.getByLabelText('Protein: 104 g, of 131 g target')).toBeTruthy();
  });

  it('says "over target" rather than relying on the colour', () => {
    render(<StatTile label="Sodium" value="2,900" unit="mg" detail="of 2,300 mg target" state="over" />);
    expect(screen.getByLabelText('Sodium: 2,900 mg, of 2,300 mg target, over target')).toBeTruthy();
  });
});
