import { authorize } from "@voiceai/auth";
import { createVoiceProfile, listSelectableVoices } from "@voiceai/db";
import { VOICE_GENDERS } from "@voiceai/shared";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** Voice switcher list: anyone who can place calls or manage voices. Provider ids are not exposed. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!authorize(user, "calls.place").allowed && !authorize(user, "voice_profiles.manage").allowed) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const g = new URL(req.url).searchParams.get("gender");
  const gender = (VOICE_GENDERS as readonly string[]).includes(g ?? "") ? (g as (typeof VOICE_GENDERS)[number]) : undefined;
  const voices = await listSelectableVoices(getDb(), user.orgId, gender);
  return Response.json(voices.map((v) => ({ id: v.id, label: v.label, gender: v.gender })));
}

export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const profile = await createVoiceProfile(getDb(), user, await req.json().catch(() => null));
    return Response.json(profile, { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
}
