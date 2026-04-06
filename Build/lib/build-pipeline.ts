export interface BuildStepResult {
  name: string;
  success: boolean;
  errors: string[];
  meta?: Record<string, number | string | boolean>;
}

export interface BuildSummary {
  success: boolean;
  errors: string[];
  steps: BuildStepResult[];
  shouldWriteBuildFinishedLock: boolean;
}

export function createBuildStepResult(
  name: string,
  success: boolean,
  errors: string[] = [],
  meta?: Record<string, number | string | boolean>
): BuildStepResult {
  return {
    name,
    success,
    errors,
    meta,
  };
}

export function summarizeBuildSteps(steps: BuildStepResult[]): BuildSummary {
  const errors = steps.flatMap(step => step.errors);
  const success = steps.every(step => step.success);

  return {
    success,
    errors,
    steps,
    shouldWriteBuildFinishedLock: success,
  };
}
