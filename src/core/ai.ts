export interface AiSuggestion { text: string; confidence: number; source: "offline" | "provider"; }
export interface AiProvider { suggest(prompt: string): Promise<AiSuggestion>; }

/** Safe default: suggestions are local and deterministic; no credentials or network are required. */
export class OfflineAiProvider implements AiProvider {
  async suggest(prompt: string): Promise<AiSuggestion> {
    const clean = prompt.trim();
    return { text: clean ? `Idee für ${clean}: Verknüpfe einen Ort, eine Person und ein offenes Geheimnis.` : "Beschreibe einen Ort, eine Person und ein offenes Geheimnis.", confidence: 0.25, source: "offline" };
  }
}

export async function requestSuggestion(provider: AiProvider | undefined, prompt: string): Promise<AiSuggestion> {
  return (provider ?? new OfflineAiProvider()).suggest(prompt);
}
