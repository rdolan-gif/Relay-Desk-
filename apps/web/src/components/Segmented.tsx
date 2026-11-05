import { Button } from '@mantine/core';

/**
 * Simple segmented choice built from buttons. Used instead of Mantine's
 * SegmentedControl, which loops on re-render with React 19 in this setup.
 */
export function Segmented(props: {
  data: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={props.label}>
      <Button.Group>
        {props.data.map((d) => (
          <Button
            key={d.value}
            size="xs"
            role="radio"
            aria-checked={props.value === d.value}
            variant={props.value === d.value ? 'filled' : 'default'}
            disabled={props.disabled}
            onClick={() => props.onChange(d.value)}
          >
            {d.label}
          </Button>
        ))}
      </Button.Group>
    </div>
  );
}
