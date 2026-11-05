-- Lead score, 0 to 100, worked out from what is known about the person now (so it is never stale): where they are in the pipeline, how the last call
-- went, what they asked about, how many calls were answered, and how recently. "Hot" is 70 or more, "warm" 40 to 69, "cold" under 40 (decided in the app).
-- Also returns the reasons in plain words, so the person looking at a lead can see why. Runs as the caller, so row-level security applies.
CREATE FUNCTION lead_score_detail(p_lead uuid)
RETURNS TABLE (score integer, reasons text[])
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  l record; ins record; connected integer; last_connected timestamptz;
  s integer := 0; r text[] := '{}'; pts integer;
BEGIN
  SELECT status, dnd_flag, consent_status INTO l FROM leads WHERE id = p_lead;
  IF NOT FOUND THEN RETURN; END IF;
  IF l.dnd_flag OR l.consent_status IN ('denied', 'withdrawn') THEN RETURN QUERY SELECT 0, ARRAY['Must not be called (Do Not Disturb or no consent)']::text[]; RETURN; END IF;
  IF l.status = 'won' THEN RETURN QUERY SELECT 100, ARRAY['Won']::text[]; RETURN; END IF;

  s := CASE l.status WHEN 'new' THEN 20 WHEN 'contacted' THEN 30 WHEN 'interested' THEN 55 WHEN 'callback_requested' THEN 60 WHEN 'not_interested' THEN 5 WHEN 'lost' THEN 5 ELSE 20 END;
  r := r || format('Status "%s" (%s%s)', replace(l.status::text, '_', ' '), CASE WHEN s >= 0 THEN '+' ELSE '' END, s);

  SELECT i.sentiment_score, i.intent INTO ins FROM call_insights i JOIN call_logs c ON c.id = i.call_log_id WHERE c.lead_id = p_lead ORDER BY c.started_at DESC LIMIT 1;
  IF FOUND THEN
    pts := round(ins.sentiment_score * 10);
    IF pts <> 0 THEN s := s + pts; r := r || format('%s last call (%s%s)', CASE WHEN pts > 0 THEN 'Positive' ELSE 'Negative' END, CASE WHEN pts > 0 THEN '+' ELSE '' END, pts); END IF;
    IF ins.intent ~* '(pric|cost|plan|demo|trial|quote|buy|purchase|callback|interested|signup|sign_up)' AND ins.intent !~* 'not_interested' THEN s := s + 15; r := array_append(r, 'Asked about price, plans or a demo (+15)');
    ELSIF ins.intent ~* '(complain|refund|cancel|not_interested|stop|unsubscribe)' THEN s := s - 10; r := array_append(r, 'Complaint or not interested (-10)'); END IF;
  END IF;

  SELECT count(*), max(started_at) INTO connected, last_connected FROM call_logs WHERE lead_id = p_lead AND status = 'connected';
  IF connected > 0 THEN
    pts := least(12, connected * 4); s := s + pts; r := r || format('%s answered call%s (+%s)', connected, CASE WHEN connected = 1 THEN '' ELSE 's' END, pts);
    IF last_connected >= now() - interval '3 days' THEN s := s + 10; r := array_append(r, 'Spoke within 3 days (+10)');
    ELSIF last_connected >= now() - interval '14 days' THEN s := s + 5; r := array_append(r, 'Spoke within 2 weeks (+5)');
    ELSIF last_connected < now() - interval '45 days' THEN s := s - 10; r := array_append(r, 'No answered call for 45 days (-10)'); END IF;
  END IF;
  RETURN QUERY SELECT greatest(0, least(100, s)), r;
END $$;--> statement-breakpoint
CREATE FUNCTION lead_score(p_lead uuid) RETURNS integer LANGUAGE sql STABLE SET search_path = public AS $$ SELECT score FROM lead_score_detail(p_lead) $$;
