/* ============================================================
   分级日志模块 — P1 修复 (D4-F4)

   核心职责:
     1. 日志分级 (DEBUG/INFO/WARN/ERROR)
     2. 生产环境默认最低级别为 INFO（抑制 DEBUG）
     3. 生产环境对 PII（姓名/邮箱/手机号/身份证）自动脱敏
     4. 替代散落在各文件中的裸 console.log/console.warn

   使用方式:
     import { logger } from '../lib/logger';
     logger.debug('agent-tools', 'extracted name:', result.name);
     logger.info('engine', 'process complete');
     logger.warn('engine', 'LLM unreachable, falling back');
     logger.error('engine', 'fatal', error);
   ============================================================ */

// ============================================================
// 级别定义
// ============================================================

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// ============================================================
// 配置
// ============================================================

interface LoggerConfig {
  /** 最低输出级别（低于此级别静默） */
  minLevel: LogLevel;
  /** 是否对日志内容做 PII 脱敏 */
  sanitizePII: boolean;
}

/**
 * 根据构建环境和浏览器 URL 参数决定日志配置:
 *   - 开发环境 (import.meta.env.DEV):  DEBUG + 不脱敏
 *   - 生产环境 (import.meta.env.PROD):  INFO + 脱敏
 *   - URL 参数 ?debug=1 (仅在开发环境生效) 可强制 DEBUG
 */
function resolveConfig(): LoggerConfig {
  const isProd = typeof import.meta !== 'undefined' && (import.meta as any).env?.PROD;

  if (isProd) {
    return { minLevel: LogLevel.INFO, sanitizePII: true };
  }

  // 开发环境: 默认 DEBUG，可通过 URL ?debug=0 降级
  const urlParams = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams('');
  const debugParam = urlParams.get('debug');
  if (debugParam === '0') {
    return { minLevel: LogLevel.WARN, sanitizePII: false };
  }

  return { minLevel: LogLevel.DEBUG, sanitizePII: false };
}

// ============================================================
// PII 脱敏规则
// ============================================================

/**
 * PII 脱敏: 替换日志字符串中的敏感个人信息
 *
 * 脱敏规则:
 *   - 手机号: 138****1234
 *   - 邮箱: t***@example.com
 *   - 中文姓名 (2-4字): 张** / 张*三
 *   - 身份证号: 前6后4
 */
function sanitizeMessage(msg: string): string {
  // 手机号 (1[3-9]\d{9})
  msg = msg.replace(/(1[3-9]\d)\d{4}(\d{4})/g, '$1****$2');
  // 邮箱 (保留首字母和域名)
  msg = msg.replace(/([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '$1***@$2');
  // 中文姓名 (2-4字，出现在标签或独立上下文中)
  msg = msg.replace(/姓名[：:]\s*"?([\u4e00-\u9fff]{2,4})"?/g, '姓名："$1***"');
  msg = msg.replace(/"name":\s*"([\u4e00-\u9fff]{2,4})"/g, '"name":"$1***"');
  // 独立3字姓名（常见模式: "张三" 或 张三, 之类）
  msg = msg.replace(/(?<=["\s,，|｜])([\u4e00-\u9fff])([\u4e00-\u9fff])([\u4e00-\u9fff]?)([\u4e00-\u9fff]?)(?=["\s,，|｜)}\]])/g, (_m: string, a: string, b: string, c: string, d: string) => {
    if (!d && !c) return `${a}*`;       // 2字: 张*
    if (!d && c) return `${a}*${c}`;    // 3字: 张*三
    return `${a}**${d}`;                // 4字: 张**四
  });
  // 身份证 (18位或15位)
  msg = msg.replace(/(\d{6})\d{8,9}(\d{2}[\dXx])/g, '$1********$2');

  return msg;
}

// ============================================================
// Logger 类
// ============================================================

class Logger {
  private config: LoggerConfig;

  constructor() {
    this.config = resolveConfig();
  }

  /** 动态更新配置（如 Dashboard 切换调试模式时调用） */
  updateConfig(partial: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getConfig(): Readonly<LoggerConfig> {
    return this.config;
  }

  // ---- 各级别日志方法 ----

  debug(module: string, ...args: unknown[]): void {
    if (this.config.minLevel > LogLevel.DEBUG) return;
    const msg = this.format(module, 'DEBUG', args);
    console.log(...(this.config.sanitizePII ? [sanitizeMessage(msg)] : [msg]));
  }

  info(module: string, ...args: unknown[]): void {
    if (this.config.minLevel > LogLevel.INFO) return;
    const msg = this.format(module, 'INFO', args);
    console.info(...(this.config.sanitizePII ? [sanitizeMessage(msg)] : [msg]));
  }

  warn(module: string, ...args: unknown[]): void {
    if (this.config.minLevel > LogLevel.WARN) return;
    const msg = this.format(module, 'WARN', args);
    console.warn(...(this.config.sanitizePII ? [sanitizeMessage(msg)] : [msg]));
  }

  error(module: string, ...args: unknown[]): void {
    // ERROR 始终输出（不可屏蔽）
    const msg = this.format(module, 'ERROR', args);
    console.error(...(this.config.sanitizePII ? [sanitizeMessage(msg)] : [msg]));
  }

  // ---- 内部 ----

  private format(module: string, level: string, args: unknown[]): string {
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const prefix = `[${ts}] [${module}] [${level}]`;
    const body = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    return `${prefix} ${body}`;
  }
}

// ============================================================
// 单例导出
// ============================================================

export const logger = new Logger();
