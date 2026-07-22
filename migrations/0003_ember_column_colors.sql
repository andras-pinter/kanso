-- Repaint the four fixed column colors to the Ember palette so existing
-- boards stop showing the bright Tailwind primaries. New boards already
-- pick these values up via `FIXED_COLUMNS` in kanso-core.
--
-- Columns are matched by name because that is the only stable identity a
-- fixed column has (position is a fractional key, ids are per-board).
UPDATE columns SET color = '#9c9084' WHERE name = 'Incoming';
UPDATE columns SET color = '#4d6ea9' WHERE name = 'Todo';
UPDATE columns SET color = '#c47a2f' WHERE name = 'In Progress';
UPDATE columns SET color = '#5c8f6a' WHERE name = 'Done';
