ALTER TABLE sms_messages ADD COLUMN sequence_step_position integer;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION worker_sequence_tick(p_limit integer DEFAULT 50) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  UPDATE sequence_enrollments e SET status = 'stopped' FROM leads l
   WHERE l.id = e.lead_id AND e.status IN ('active', 'paused') AND (l.dnd_flag OR l.consent_status IN ('denied', 'withdrawn'));
  WITH due AS (
    SELECT e.id, e.org_id, e.lead_id, e.next_step AS step_position, s.body, s.dlt_template_id
      FROM sequence_enrollments e
      JOIN sequences q ON q.id = e.sequence_id AND q.status = 'active'
      JOIN sequence_steps s ON s.sequence_id = e.sequence_id AND s.position = e.next_step
     WHERE e.status = 'active' AND e.next_run_at <= now()
     ORDER BY e.next_run_at LIMIT greatest(1, least(p_limit, 200)) FOR UPDATE OF e SKIP LOCKED
  ), queued AS (
    INSERT INTO sms_messages (org_id, lead_id, direction, body, status, dlt_template_id, enrollment_id, sequence_step_position)
    SELECT d.org_id, d.lead_id, 'outbound', d.body, 'queued', d.dlt_template_id, d.id, d.step_position FROM due d
    RETURNING enrollment_id
  )
  UPDATE sequence_enrollments e SET
      next_step = e.next_step + 1,
      next_run_at = now() + make_interval(mins => coalesce((SELECT n.delay_min FROM sequence_steps n WHERE n.sequence_id = e.sequence_id AND n.position = e.next_step + 1), 0)),
      status = CASE WHEN EXISTS (SELECT 1 FROM sequence_steps n WHERE n.sequence_id = e.sequence_id AND n.position = e.next_step + 1) THEN 'active' ELSE 'completed' END
   WHERE e.id IN (SELECT id FROM due);
END $$;
