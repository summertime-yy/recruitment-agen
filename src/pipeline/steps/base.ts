/* ============================================================
   BaseStep — PipelineStep 的便捷基类

   提供默认实现，子类只需覆盖 execute() 即可。
   减少 7 个 Step 类的样板代码。
   ============================================================ */

import type { PipelineStep, PipelineContext, StepResult, StepErrorStrategy } from '../types';

export interface BaseStepOptions {
  name: string;
  description: string;
  dependencies?: string[];
  enabled?: boolean;
  onError?: StepErrorStrategy;
  maxRetries?: number;
}

export abstract class BaseStep implements PipelineStep {
  readonly name: string;
  readonly description: string;
  readonly dependencies: string[];
  readonly enabled: boolean;
  readonly onError: StepErrorStrategy;
  readonly maxRetries: number;

  constructor(options: BaseStepOptions) {
    this.name = options.name;
    this.description = options.description;
    this.dependencies = options.dependencies ?? [];
    this.enabled = options.enabled ?? true;
    this.onError = options.onError ?? 'halt';
    this.maxRetries = options.maxRetries ?? 0;
  }

  abstract execute(ctx: PipelineContext): Promise<StepResult>;

  /** 便捷：创建成功结果 */
  protected ok(metrics?: Record<string, unknown>): StepResult {
    return { success: true, metrics };
  }

  /** 便捷：创建失败结果 */
  protected fail(error: string, metrics?: Record<string, unknown>): StepResult {
    return { success: false, error, metrics };
  }
}
