import { getAgentConfig, listKnowledge } from "@voiceai/db";
import { AgentConsole } from "@/components/agent-console";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/ui/page";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { checkProviders } from "@/lib/providers";
import { getDb } from "@/lib/server";
import { voiceOptionsFor } from "@/lib/voices";

export default async function AgentConsolePage() {
  const user = await requirePageUser();
  if (!user.permissions.includes("studio.use")) return <Forbidden />;
  const [cfg, voices, providers, docs] = await Promise.all([
    getAgentConfig(getDb(), user), voiceOptionsFor(user), checkProviders(),
    user.permissions.includes("kb.read") ? allowed(() => listKnowledge(getDb(), user)) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title="Agent console" description="Talk or type to your AI agent exactly as a caller would, using your prompt and knowledge base." />
      <AgentConsole greeting={cfg.greeting} disclosure={cfg.disclosure} voices={voices} askg1Reachable={providers.askg1.configured ? providers.askg1.reachable : false} hasKb={(docs ?? []).length > 0} />
    </>
  );
}
