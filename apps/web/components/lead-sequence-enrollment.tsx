"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Select } from "./ui/form";
import { T } from "./t";

interface SequenceOption { id: string; name: string; status: string }

export function LeadSequenceEnrollment({ leadId, sequences }: { leadId: string; sequences: SequenceOption[] }) {
  const router = useRouter();
  const active = sequences.filter((s) => s.status === "active");
  const [sequenceId, setSequenceId] = useState(active[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function enroll() {
    if (!sequenceId) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const res = await fetch(`/api/sequences/${sequenceId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId }) });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) { setError(result.message ?? result.issues?.[0]?.message ?? result.error ?? "Could not enrol this lead"); return; }
      setMessage(result.added ? "Lead enrolled." : "Lead is already enrolled.");
      router.refresh();
    } catch { setError("Could not reach the server. Try again."); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader title="Follow-up sequence" description="Enrol this lead in one active sequence." />
      <CardBody className="grid gap-3">
        {!active.length ? <p className="text-sm text-muted-foreground"><T>No active sequences are available.</T></p> : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1"><Field label="Sequence"><Select value={sequenceId} onChange={(e) => setSequenceId(e.target.value)}>{active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field></div>
            <Button onClick={() => void enroll()} disabled={busy || !sequenceId}>{busy ? "Enrolling…" : "Enrol lead"}</Button>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-danger"><T>{error}</T></p>}
        {message && <p role="status" className="text-sm text-success"><T>{message}</T></p>}
      </CardBody>
    </Card>
  );
}
