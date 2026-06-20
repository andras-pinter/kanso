import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import DueBadge from '../DueBadge';

function startOfToday(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const DAY = 24 * 60 * 60 * 1000;

describe('DueBadge', () => {
  it('renders "Today" for today', () => {
    const { container } = render(<DueBadge dueAt={startOfToday()} />);
    expect(container.textContent).toContain('Today');
  });

  it('renders "Tomorrow" for +1 day', () => {
    const { container } = render(<DueBadge dueAt={startOfToday() + DAY} />);
    expect(container.textContent).toContain('Tomorrow');
  });

  it('applies overdue class when due_at is before today', () => {
    const { container } = render(<DueBadge dueAt={startOfToday() - DAY} />);
    const badge = container.querySelector('.kanso-due-badge');
    expect(badge?.className).toContain('kanso-due-badge--overdue');
  });

  it('does not apply overdue class for today', () => {
    const { container } = render(<DueBadge dueAt={startOfToday()} />);
    const badge = container.querySelector('.kanso-due-badge');
    expect(badge?.className).not.toContain('kanso-due-badge--overdue');
  });
});
