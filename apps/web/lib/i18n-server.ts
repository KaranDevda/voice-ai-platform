import "server-only";
import { cookies } from "next/headers";
import { asLang, LANG_COOKIE, tr } from "./i18n";

/** `text` in the language chosen for this visitor (cookie), or in English when there is no translation. For server components. */
export async function trServer(text: string): Promise<string> {
  return tr(asLang((await cookies()).get(LANG_COOKIE)?.value), text);
}
