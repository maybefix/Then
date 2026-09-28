import { useEffect, useRef, useState } from "react";

type BoundedNumberInputProps = {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
};

export function BoundedNumberInput({
  value,
  min,
  max,
  step,
  onChange,
}: BoundedNumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(value));
  }, [value]);

  return (
    <input
      ref={inputRef}
      min={min}
      max={max}
      step={step}
      type="number"
      value={draft}
      onChange={(event) => {
        const nextDraft = event.currentTarget.value;
        setDraft(nextDraft);
        const nextValue = event.currentTarget.valueAsNumber;
        if (Number.isFinite(nextValue) && nextValue >= min && nextValue <= max) {
          onChange(nextValue);
        }
      }}
      onBlur={() => {
        const nextValue = inputRef.current?.valueAsNumber;
        if (nextValue !== undefined && Number.isFinite(nextValue)) {
          const boundedValue = Math.min(max, Math.max(min, nextValue));
          onChange(boundedValue);
          setDraft(String(boundedValue));
        } else {
          setDraft(String(value));
        }
      }}
    />
  );
}
