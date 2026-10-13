import '@/ui/primitives.css';

export interface StepperProps {
  /** Names the whole control, the two buttons and the value. */
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  /** Lets a caller point a <label htmlFor> at the value. */
  id?: string;
}

export function Stepper({ label, value, min, max, step, onChange, id }: StepperProps) {
  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper__btn"
        aria-label={`Diminuer ${label}`}
        disabled={value - step < min}
        onClick={() => onChange(value - step)}
      >
        {'\u2212'}
      </button>
      {/* The value carries the control's name, because a bare <span> read out
          as a number with nothing attached to it - "6", with no "Eau". An
          <output> rather than a span so that a caller's <label htmlFor> can
          address it at all: output is labelable, a span is not. The explicit
          spinbutton role is what makes aria-valuenow meaningful, and it
          replaces output's implicit live region, which would re-announce the
          count on every tap. */}
      <output
        id={id}
        className="stepper__value"
        role="spinbutton"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
      >
        {value}
      </output>
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
