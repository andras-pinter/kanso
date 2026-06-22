import { useTheme, type ThemePreference } from './useTheme';

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: string }> = [
  { value: 'light', label: 'Light', icon: '☀' },
  { value: 'system', label: 'System', icon: '⌂' },
  { value: 'dark', label: 'Dark', icon: '☾' },
];

export default function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  return (
    <div className="kanso-theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map((opt) => {
        const active = preference === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`kanso-theme-btn${active ? ' kanso-theme-btn--active' : ''}`}
            aria-pressed={active}
            aria-label={`${opt.label} theme`}
            title={`${opt.label} theme`}
            onClick={() => setPreference(opt.value)}
          >
            <span aria-hidden="true">{opt.icon}</span>
          </button>
        );
      })}
    </div>
  );
}
