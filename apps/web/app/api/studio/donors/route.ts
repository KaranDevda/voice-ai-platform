import { z } from "zod";
import { assertAuthorized } from "@voiceai/auth";
import { findOrCreateVoiceDonor } from "@voiceai/db";
import { getDb } from "@/lib/server";
import { studioRoute } from "@/lib/studio-route";

const body = z.object({
  firstName: z.string().trim().min(1, "Enter a first name").max(60),
  lastName: z.string().trim().min(1, "Enter a last name").max(60),
});

/** Finds the person by first and last name, or adds them, so a voice can be cloned without picking a staff account. */
export const POST = (req: Request) =>
  studioRoute({ mutation: true }, async (user) => {
    assertAuthorized(user, "voice_profiles.manage");
    const input = body.safeParse(await req.json().catch(() => null));
    if (!input.success) return Response.json({ error: "invalid_request", message: input.error.issues[0]?.message ?? "Enter a first and last name" }, { status: 400 });
    return Response.json(await findOrCreateVoiceDonor(getDb(), user, input.data.firstName, input.data.lastName));
  });
