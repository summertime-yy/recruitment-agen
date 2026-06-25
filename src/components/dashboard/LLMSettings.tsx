/* ============================================================
   LLMSettings — LLM 配置面板
   配置 API Key、Base URL、Model、Temperature 等参数
   ============================================================ */

import { useState, useEffect } from 'react';
import { getLLMClient, type LLMConfig, DEFAULT_LLM_CONFIG } from '../../lib/llm-client';
import { getAgentEngine } from '../../lib/agent-engine';
import { secureSet, secureGet, maskKey } from '../../lib/secure-storage';

/** 加密存储的 key 名称 */
const SECURE_API_KEY = 'llm-api-key';

export function LLMSettings() {
  const [config, setConfig] = useState<LLMConfig>(DEFAULT_LLM_CONFIG);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'idle' | 'success' | 'error'>('idle');

  const [hasSavedKey, setHasSavedKey] = useState(false);

  useEffect(() => {
    const llm = getLLMClient();
    const current = llm.getConfig();
    // 尝试从加密存储恢复 API Key
    secureGet(SECURE_API_KEY).then(savedKey => {
      if (savedKey) {
        setConfig({ ...current, apiKey: savedKey });
        setHasSavedKey(true);
      } else {
        setConfig(current);
      }
    });
  }, []);

  const handleSave = () => {
    const llm = getLLMClient(config);
    getAgentEngine().updateLLMConfig(config);
    // 加密存储 API Key
    secureSet(SECURE_API_KEY, config.apiKey).then(() => {
      setHasSavedKey(!!config.apiKey);
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    if (!config.apiKey) return;
    setTesting(true);
    setTestResult('idle');

    try {
      const llm = getLLMClient(config);
      await llm.complete({
        messages: [{ role: 'user', content: '请回复 "OK"' }],
        temperature: 0,
        maxTokens: 10,
      });
      setTestResult('success');
    } catch {
      setTestResult('error');
    } finally {
      setTesting(false);
    }
  };

  const update = (key: keyof LLMConfig, value: unknown) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setSaved(false);
    setTestResult('idle');
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">LLM 配置</h3>

      {/* 启用开关 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-700 dark:text-slate-300">启用 LLM 模式</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">关闭时使用本地规则引擎</p>
        </div>
        <button
          onClick={() => update('enabled', !config.enabled)}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            config.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        >
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            config.enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`} />
        </button>
      </div>

      {/* API Key */}
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
          API Key
        </label>
        <input
          type="password"
          value={config.apiKey}
          onChange={e => { update('apiKey', e.target.value); setHasSavedKey(false); }}
          placeholder={hasSavedKey ? `已保存 (${maskKey(config.apiKey)})` : 'sk-...'}
          className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30"
        />
      </div>

      {/* Base URL */}
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
          API 地址
        </label>
        <input
          type="text"
          value={config.baseUrl}
          onChange={e => update('baseUrl', e.target.value)}
          placeholder="https://api.openai.com/v1"
          className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30"
        />
      </div>

      {/* Model */}
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
          模型
        </label>
        <input
          type="text"
          list="model-suggestions"
          value={config.model}
          onChange={e => update('model', e.target.value)}
          placeholder="输入模型 ID，如 gpt-4o-mini"
          className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30"
        />
        <datalist id="model-suggestions">
          <option value="doubao-seed-2-1-turbo-260628" />
          <option value="doubao-1-5-pro-256k" />
          <option value="doubao-vision-pro-32k" />
          <option value="gpt-4o-mini" />
          <option value="gpt-4o" />
          <option value="gpt-4-turbo" />
          <option value="gpt-4.1" />
          <option value="o4-mini" />
          <option value="deepseek-chat" />
          <option value="deepseek-reasoner" />
          <option value="claude-3-5-sonnet" />
          <option value="claude-sonnet-4-20250514" />
          <option value="qwen-plus" />
          <option value="qwen-max" />
          <option value="glm-4" />
          <option value="gemini-2.5-flash" />
        </datalist>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
          支持任意兼容 OpenAI API 格式的模型 ID，直接输入即可
        </p>
      </div>

      {/* Temperature */}
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
          温度 (Temperature): {config.temperature}
        </label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={config.temperature}
          onChange={e => update('temperature', parseFloat(e.target.value))}
          className="w-full accent-emerald-500"
        />
        <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500">
          <span>精确 0</span>
          <span>平衡 1.0</span>
          <span>创意 2.0</span>
        </div>
      </div>

      {/* Max Tokens */}
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
          最大 Token: {config.maxTokens}
        </label>
        <input
          type="range"
          min="256"
          max="8192"
          step="256"
          value={config.maxTokens}
          onChange={e => update('maxTokens', parseInt(e.target.value))}
          className="w-full accent-emerald-500"
        />
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            saved
              ? 'bg-emerald-500 text-white'
              : 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800 hover:bg-slate-700 dark:hover:bg-slate-300'
          }`}
        >
          {saved ? '✓ 已保存' : '保存配置'}
        </button>
        <button
          onClick={handleTest}
          disabled={!config.apiKey || testing}
          className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {testing ? '测试中...' : '测试连接'}
        </button>
        {testResult === 'success' && (
          <span className="flex items-center text-xs text-emerald-500">✓ 连接成功</span>
        )}
        {testResult === 'error' && (
          <span className="flex items-center text-xs text-red-500">✗ 连接失败</span>
        )}
      </div>

      {/* 提示信息 */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
        <p className="text-xs text-amber-700 dark:text-amber-400">
          支持所有兼容 OpenAI API 格式的服务（DeepSeek、Qwen、GLM 等）。API Key 使用 AES-256-GCM 加密存储在浏览器本地。
        </p>
      </div>
    </div>
  );
}
