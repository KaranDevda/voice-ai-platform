-- Errors can be marked resolved (and re-opened). A new occurrence is always a new, open row.
ALTER TABLE app_errors ADD COLUMN resolved_at timestamptz;--> statement-breakpoint
ALTER TABLE app_errors ADD COLUMN resolved_by uuid REFERENCES users(id);
