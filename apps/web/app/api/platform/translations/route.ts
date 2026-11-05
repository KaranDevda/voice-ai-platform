import { z } from "zod";
import { addLanguage, deleteLanguage, listExtraLanguages, saveTranslation } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { LANGUAGES, TRANSLATABLE } from "@/lib/i18n";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), lang: z.string().max(10), key: z.string().max(200), value: z.string().max(400) }),
  z.object({ action: z.literal("addLanguage"), code: z.string().max(10), name: z.string().max(60), rtl: z.boolean().default(false) }),
  z.object({ action: z.literal("deleteLanguage"), code: z.string().max(10) }),
]);

/** Platform staff: change a translation (empty removes the change), add a language, or remove an added language with its translations. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const b = body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const builtIn = LANGUAGES.map((l) => l.code as string), db = getDb();
    if (b.data.action === "addLanguage") return Response.json(await addLanguage(db, user, b.data, builtIn), { status: 201 });
    if (b.data.action === "deleteLanguage") return Response.json(await deleteLanguage(db, user, b.data.code));
    const langs = [...builtIn.filter((c) => c !== "en"), ...(await listExtraLanguages(db)).map((l) => l.code)];
    return Response.json(await saveTranslation(db, user, b.data, TRANSLATABLE, langs));
  } catch (err) { return toResponse(err); }
}
