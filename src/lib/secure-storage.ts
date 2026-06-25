/* ============================================================
   Secure Storage — Web Crypto API 加密存储
   
   使用 AES-GCM 加密敏感数据（如 API Key）后再写入 localStorage。
   派生密钥基于浏览器指纹 (UserAgent + 屏幕尺寸) 的 SHA-256 摘要。
   注意：此方案不防物理访问，仅防止明文泄露到磁盘。
   ============================================================ */

const KEY_PREFIX = 'recruitment-agent-secure:';
const ENCRYPTION_ALGO = { name: 'AES-GCM', length: 256 } as const;

/** 基于浏览器环境派生加密密钥 */
async function deriveKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(navigator.userAgent + screen.width + screen.height + 'recruitment-agent-salt'),
  );
  return crypto.subtle.importKey('raw', material, ENCRYPTION_ALGO, false, ['encrypt', 'decrypt']);
}

/** 加密并存储到 localStorage */
export async function secureSet(key: string, value: string): Promise<void> {
  if (!value) {
    localStorage.removeItem(KEY_PREFIX + key);
    return;
  }
  const cryptoKey = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { ...ENCRYPTION_ALGO, iv },
    cryptoKey,
    enc.encode(value),
  );
  // 存储格式: iv(12 bytes) + ciphertext → Base64
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  localStorage.setItem(KEY_PREFIX + key, btoa(String.fromCharCode(...combined)));
}

/** 从 localStorage 解密读取 */
export async function secureGet(key: string): Promise<string | null> {
  const stored = localStorage.getItem(KEY_PREFIX + key);
  if (!stored) return null;
  try {
    const combined = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const cryptoKey = await deriveKey();
    const decrypted = await crypto.subtle.decrypt(
      { ...ENCRYPTION_ALGO, iv },
      cryptoKey,
      ciphertext,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // 解密失败（跨浏览器/隐私模式等）→ 清除损坏数据
    localStorage.removeItem(KEY_PREFIX + key);
    return null;
  }
}

/** 删除加密存储 */
export function secureRemove(key: string): void {
  localStorage.removeItem(KEY_PREFIX + key);
}

/** 对已保存的 Key 生成掩码显示（前4后4） */
export function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}
