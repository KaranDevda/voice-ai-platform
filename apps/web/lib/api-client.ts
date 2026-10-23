/** Turns an API error response into a message a person can act on. Client-safe. */
export async function apiError(res: Response): Promise<{ message: string; hint?: string }> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string; hint?: string; provider?: string };
  switch (body.error) {
    case "provider_not_configured": return { message: `${label(body.provider)} is not set up yet.`, hint: body.hint };
    case "provider_unreachable": return { message: `${label(body.provider)} could not be reached.`, hint: "Check your network or VPN connection and try again." };
    case "provider_error": return { message: `${label(body.provider)} reported a problem: ${body.message ?? "unknown error"}` };
    case "forbidden": return { message: "You do not have permission to do that." };
    case "unauthenticated": return { message: "Your session expired. Sign in again." };
    case "file_too_large": return { message: body.message ?? "That file is too large." };
    case "invalid_request": return { message: body.message ?? "Some of the details are not valid. Check them and try again." };
    default: return { message: body.message ?? body.error ?? `Something went wrong (${res.status}).` };
  }
}

const label = (p?: string) => ({ deepgram: "Deepgram", elevenlabs: "ElevenLabs", askg1: "AskG1" }[p ?? ""] ?? "The provider");
