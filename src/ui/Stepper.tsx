import '@/ui/primitives.css';

export interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
}

export function Stepper({ label, value, min, max, step, onChange }: StepperProps) {
  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper__btn"
        aria-label={`Diminuer ${label}`}
        disabled={value - step < min}
        onClick={() => onChange(value - step)}
      >
        {'−'}
      </button>
      <span className="stepper__value">{value}</span>
      <button
        type="button"
        className="stepper__btn"
        aria-label={`Augmenter ${label}`}
        disabled={value + step > max}
        onClick={() => onChange(value + step)}
      >
        +
      </button>
    </div>
  );
}
