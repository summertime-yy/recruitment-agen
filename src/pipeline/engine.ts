/* ============================================================
   PipelineRunner — P1 修复 (C-2)

   核心职责:
     1. 按拓扑顺序执行 Step 链
     2. 处理 Step 错误（halt / skip / retry / fallback）
     3. 收集执行日志和指标
     4. 返回最终 AgentResponse

   设计决策:
     - 可变 PipelineContext：Step 可以原地修改 ctx（性能优先，不深拷贝）
     - 默认串行执行：稳定性优先于并行，避免状态竞争
   ============================================================ */

import type {
  PipelineContext, PipelineStep, PipelineConfig,
} from './types';
import { logger } from '../lib/logger';

// ============================================================
// PipelineRunner
// ============================================================

export class PipelineRunner {
  private config: PipelineConfig;

  constructor(config: PipelineConfig) {
    this.config = config;
    this.validateConfig(config);
  }

  /**
   * 执行完整流水线
   *
   * @param ctx - 流水线上下文（原地修改，调用方可通过返回值获取最终状态）
   * @returns 最终 ctx（含 response / logs / executionPath）
   */
  async run(ctx: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();
    logger.info('pipeline', `Starting "${this.config.name}" (v${this.config.version}) with ${this.config.steps.length} steps`);

    const enabledSteps = this.config.steps.filter(s => s.enabled);
    logger.debug('pipeline', `${enabledSteps.length} enabled, ${this.config.steps.length - enabledSteps.length} disabled`);

    let aborted = false;

    for (const step of enabledSteps) {
      if (aborted) break;

      ctx.executionPath.push(step.name);
      const stepStart = Date.now();

      logger.debug('pipeline', `[${step.name}] executing...`);

      try {
        let result = await step.execute(ctx);
        let retries = 0;

        // 重试逻辑
        while (!result.success && step.onError === 'retry' && retries < step.maxRetries) {
          retries++;
          logger.warn('pipeline', `[${step.name}] retry ${retries}/${step.maxRetries}: ${result.error}`);
          result = await step.execute(ctx);
        }

        const duration = Date.now() - stepStart;

        if (result.success) {
          ctx.logs.push({ step: step.name, level: 'info', message: `OK (${duration}ms)` });
          logger.debug('pipeline', `[${step.name}] OK (${duration}ms)`);
        } else {
          // 错误处理
          const action = this.handleStepError(step, result.error || 'unknown error', duration, ctx);

          switch (action) {
            case 'halt':
              ctx.logs.push({ step: step.name, level: 'error', message: `HALT: ${result.error}` });
              aborted = true;
              break;
            case 'skip':
              ctx.logs.push({ step: step.name, level: 'warn', message: `SKIPPED: ${result.error}` });
              break;
            case 'fallback':
              ctx.logs.push({ step: step.name, level: 'warn', message: `FALLBACK: ${result.error}` });
              break;
            default:
              break;
          }
        }

        // 检查是否需要提前终止
        if (result.stopPipeline) {
          logger.info('pipeline', `[${step.name}] requested pipeline stop`);
          aborted = true;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const duration = Date.now() - stepStart;
        ctx.logs.push({ step: step.name, level: 'error', message: `PANIC: ${errorMsg}` });

        const action = this.handleStepError(step, errorMsg, duration, ctx);
        if (action === 'halt') aborted = true;
      }
    }

    const totalDuration = Date.now() - startTime;
    logger.info('pipeline', `Completed "${this.config.name}" in ${totalDuration}ms` +
      ` [${ctx.executionPath.join(' → ')}]` +
      (aborted ? ' (aborted)' : ''));

    return ctx;
  }

  // ============================================================
  // 错误处理
  // ============================================================

  private handleStepError(
    step: PipelineStep,
    errorMsg: string,
    duration: number,
    ctx: PipelineContext,
  ): 'halt' | 'skip' | 'fallback' | 'continue' {
    switch (step.onError) {
      case 'halt':
        logger.error('pipeline', `[${step.name}] HALT on error: ${errorMsg}`);
        return 'halt';

      case 'skip':
        logger.warn('pipeline', `[${step.name}] SKIP on error: ${errorMsg}`);
        return 'skip';

      case 'fallback':
        logger.warn('pipeline', `[${step.name}] FALLBACK triggered: ${errorMsg}`);
        this.appendFallbackLog(ctx, step.name, errorMsg);
        return 'fallback';

      default:
        return 'continue';
    }
  }

  private appendFallbackLog(ctx: PipelineContext, stepName: string, error: string): void {
    ctx.logs.push({ step: stepName, level: 'warn', message: `FALLBACK: ${error}` });
  }

  // ============================================================
  // 配置校验
  // ============================================================

  private validateConfig(config: PipelineConfig): void {
    const stepNames = new Set(config.steps.map(s => s.name));

    // 检查依赖是否存在于 Step 列表中
    for (const step of config.steps) {
      for (const dep of step.dependencies) {
        if (!stepNames.has(dep)) {
          logger.warn('pipeline', `Step "${step.name}" depends on "${dep}" which is not in the step list`);
        }
      }
    }

    // 检查名称唯一性
    if (stepNames.size !== config.steps.length) {
      logger.warn('pipeline', 'Duplicate step names detected in pipeline config');
    }
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createPipelineRunner(config: PipelineConfig): PipelineRunner {
  return new PipelineRunner(config);
}
