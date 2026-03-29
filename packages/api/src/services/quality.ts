import type { QualityReport, QualityCheck } from '@swarmdock/shared';

const VALID_CONTENT_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/html',
  'text/csv',
  'application/json',
  'application/xml',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'audio/mpeg',
  'video/mp4',
]);

interface Artifact {
  content?: string | null;
  contentType?: string | null;
  url?: string | null;
  key?: string | null;
  byteLength?: number | null;
  [key: string]: unknown;
}

interface TaskInput {
  id: string;
  inputData?: {
    expectedOutputSchema?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

/**
 * Run basic checks on artifacts: non-empty content, valid content type.
 */
export function runBasicChecks(artifacts: Artifact[]): QualityCheck[] {
  const checks: QualityCheck[] = [];

  if (artifacts.length === 0) {
    checks.push({
      name: 'artifacts_present',
      score: 0,
      passed: false,
      details: 'No artifacts provided',
    });
    return checks;
  }

  checks.push({
    name: 'artifacts_present',
    score: 1,
    passed: true,
    details: `${artifacts.length} artifact(s) provided`,
  });

  for (let i = 0; i < artifacts.length; i++) {
    const artifact = artifacts[i];

    // Check non-empty content
    const hasContent = !!(artifact.content && artifact.content.length > 0);
    const hasUrl = !!(artifact.url && artifact.url.length > 0);
    const hasKey = !!(artifact.key && artifact.key.length > 0);
    const isNonEmpty = hasContent || hasUrl || hasKey;

    checks.push({
      name: `artifact_${i}_non_empty`,
      score: isNonEmpty ? 1 : 0,
      passed: isNonEmpty,
      details: isNonEmpty
        ? `Artifact ${i} has content`
        : `Artifact ${i} is empty (no content, url, or key)`,
    });

    // Check content type
    const contentType = artifact.contentType ?? null;
    const hasValidType = contentType != null && VALID_CONTENT_TYPES.has(contentType);

    checks.push({
      name: `artifact_${i}_content_type`,
      score: hasValidType ? 1 : contentType != null ? 0.5 : 0,
      passed: contentType != null,
      details: hasValidType
        ? `Valid content type: ${contentType}`
        : contentType != null
          ? `Unknown content type: ${contentType}`
          : `Artifact ${i} missing content type`,
    });

    // Check reasonable content length (if inline content)
    if (hasContent) {
      const len = artifact.content!.length;
      const reasonable = len >= 1 && len <= 10_000_000; // 10MB text max
      checks.push({
        name: `artifact_${i}_content_length`,
        score: reasonable ? 1 : 0.3,
        passed: reasonable,
        details: reasonable
          ? `Content length: ${len} characters`
          : `Content length ${len} outside reasonable range`,
      });
    }
  }

  return checks;
}

/**
 * Validate artifacts against an expected output schema (if provided in the task input).
 * This is a simple structural check -- not a full JSON Schema validator.
 */
function runSchemaChecks(
  artifacts: Artifact[],
  schema: Record<string, unknown>,
): QualityCheck[] {
  const checks: QualityCheck[] = [];

  // Check if any artifact has JSON content that matches expected keys
  const expectedKeys = Object.keys(schema.properties ?? schema);
  if (expectedKeys.length === 0) {
    checks.push({
      name: 'schema_validation',
      score: 1,
      passed: true,
      details: 'No schema properties to validate',
    });
    return checks;
  }

  let matched = false;

  for (let i = 0; i < artifacts.length; i++) {
    const artifact = artifacts[i];
    if (!artifact.content || artifact.contentType !== 'application/json') continue;

    try {
      const parsed = JSON.parse(artifact.content);
      if (typeof parsed !== 'object' || parsed === null) continue;

      const presentKeys = Object.keys(parsed);
      const matchedKeys = expectedKeys.filter((k) => presentKeys.includes(k));
      const ratio = matchedKeys.length / expectedKeys.length;

      checks.push({
        name: `artifact_${i}_schema_match`,
        score: ratio,
        passed: ratio >= 0.5,
        details: `Matched ${matchedKeys.length}/${expectedKeys.length} expected keys`,
      });
      matched = true;
    } catch {
      // Not valid JSON, skip
    }
  }

  if (!matched) {
    checks.push({
      name: 'schema_validation',
      score: 0.5,
      passed: true,
      details: 'No JSON artifacts to validate against schema',
    });
  }

  return checks;
}

/**
 * Verify the output of a task submission.
 *
 * Runs basic checks (non-empty, valid types) and optional schema validation.
 * Returns a QualityReport with overall score, individual checks, and pass/fail.
 *
 * TODO: Add LLM judge integration (v0.5+) — separate model assesses output
 * quality against task requirements. Configure via LLM_JUDGE_API_KEY env var.
 */
export function verifyTaskOutput(
  task: TaskInput,
  artifacts: Artifact[],
): QualityReport {
  const checks: QualityCheck[] = [];

  // Run basic artifact checks
  checks.push(...runBasicChecks(artifacts));

  // Run schema validation if expected output schema is defined
  const expectedSchema = (task.inputData as Record<string, unknown> | null)?.expectedOutputSchema;
  if (expectedSchema && typeof expectedSchema === 'object') {
    checks.push(...runSchemaChecks(artifacts, expectedSchema as Record<string, unknown>));
  }

  // Calculate overall score as weighted average of all checks
  const totalScore = checks.reduce((sum, c) => sum + c.score, 0);
  const overallScore = checks.length > 0 ? totalScore / checks.length : 0;

  // Passed if overall score >= 0.5 and no critical failures
  const hasCriticalFailure = checks.some(
    (c) => c.name === 'artifacts_present' && !c.passed,
  );
  const passed = overallScore >= 0.5 && !hasCriticalFailure;

  return {
    overallScore: Math.round(overallScore * 1000) / 1000,
    checks,
    passed,
  };
}
