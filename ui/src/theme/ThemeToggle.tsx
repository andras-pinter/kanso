import { Moon, Monitor, Sun, type LucideIcon } from 'lucide-react';
import { useTheme, type ThemePreference } from './useTheme';

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; Icon: LucideIcon }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

export default function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  return (
    <div className="kanso-theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            className={`kanso-theme-btn${active ? ' kanso-theme-btn--active' : ''}`}
            aria-pressed={active}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => setPreference(value)}
          >
            <Icon size={14} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
