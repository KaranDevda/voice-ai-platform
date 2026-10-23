import { voiceOptionsFor } from "@/lib/voices";
import { studioRoute } from "@/lib/studio-route";

export const GET = () => studioRoute({}, async (user) => Response.json(await voiceOptionsFor(user)));
