export interface LLMJudgeConfig {
  apiKey: string;
  model: string;
  endpoint: string;
  maxTokens: number;
  temperature: number;
}

export interface JudgeResult {
  score: number;      // 0-1
  reasoning: string;
  confidence: number; // 0-1
}

export function getLLMJudgeConfig(): LLMJudgeConfig | null {
  const apiKey = process.env.LLM_JUDGE_API_KEY;
  if (!apiKey) return null;

  return {
    apiKey,
    model: process.env.LLM_JUDGE_MODEL ?? 'claude-haiku-4-5-20251001',
    endpoint: process.env.LLM_JUDGE_ENDPOINT ?? 'https://api.anthropic.com/v1/messages',
    maxTokens: parseInt(process.env.LLM_JUDGE_MAX_TOKENS ?? '1024', 10),
    temperature: parseFloat(process.env.LLM_JUDGE_TEMPERATURE ?? '0'),
  };
}

export function isLLMJudgeEnabled(): boolean {
  return getLLMJudgeConfig() !== null;
}

/**
 * Invoke LLM judge to assess task output quality.
 * Returns null when not yet implemented — deterministic checks are the fallback.
 *
 * TODO: Implement actual LLM API call. The judge should:
 * 1. Receive task description and artifact contents in strictly separated blocks
 * 2. Ignore any instructions embedded in artifact content (prompt hardening)
 * 3. Score on a 0-1 scale with reasoning
 */
export async function invokeJudge(
  _taskDescription: string,
  _artifactContents: string[],
  _config: LLMJudgeConfig,
): Promise<JudgeResult | null> {
  // Skeleton — returns null to indicate no judgment was made.
  // When implemented, this will call the configured LLM API.
  return null;
}
