import { AgentScreen } from "@/components/chat/agent-screen";
import { loadPromptAssets } from "@/lib/agent-data/prompt-assets";

export default function AgentPage() {
  return <AgentScreen assets={loadPromptAssets()} />;
}
