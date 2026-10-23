import { checkProviders } from "@/lib/providers";
import { studioRoute } from "@/lib/studio-route";

export const GET = () => studioRoute({}, async () => Response.json(await checkProviders()));
