// Minimal swatch grid for choosing column / board colors. Mounts as a small
// popover the parent renders inline.

interface Props {
  value: string | null;
  onChange: (color: string | null) => void;
}

const SWATCHES = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const;

export default function ColorPicker({ value, onChange }: Props) {
  return (
    <div className="kanso-color-picker" role="group" aria-label="Color">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          className={`kanso-swatch${value === c ? ' kanso-swatch--active' : ''}`}
          style={{ backgroundColor: c }}
          aria-label={`Color ${c}`}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
        />
      ))}
      <button
        type="button"
        className={`kanso-swatch kanso-swatch--clear${value === null ? ' kanso-swatch--active' : ''}`}
        aria-label="No color"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
      >
        ×
      </button>
    </div>
  );
}
