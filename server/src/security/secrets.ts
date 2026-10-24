import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * §8.2 密钥存储 + §7.1 Hook 回调鉴权 token。
 * - ~/.agentops/master-key   32 字节随机主密钥（0600，启动时若无则生成）
 * - ~/.agentops/config.enc   AES-256-GCM 加密的配置（如 DeepSeek API Key）
 * - ~/.agentops/hook-token   hook 回调鉴权 token（0600）
 */

export interface StoredConfig {
  deepseek_api_key?: string;
  commander_backend?: 'kimi' | 'deepseek';
  [k: string]: string | undefined;
}

export class KeyStore {
  readonly dir: string;
  private readonly masterKeyPath: string;
  private readonly configPath: string;
  private readonly hookTokenPath: string;
  private masterKey: Buffer;

  constructor(baseDir?: string) {
    this.dir = baseDir ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.agentops');
    this.masterKeyPath = path.join(this.dir, 'master-key');
    this.configPath = path.join(this.dir, 'config.enc');
    this.hookTokenPath = path.join(this.dir, 'hook-token');
    fs.mkdirSync(this.dir, { recursive: true });
    this.masterKey = this.loadOrCreateMasterKey();
  }

  private writeSecret(file: string, content: string): void {
    fs.writeFileSync(file, content, { mode: 0o600 });
    try {
      fs.chmodSync(file, 0o600); // Windows 下尽力而为
    } catch {
      /* ignore */
    }
  }

  private loadOrCreateMasterKey(): Buffer {
    if (fs.existsSync(this.masterKeyPath)) {
      const hex = fs.readFileSync(this.masterKeyPath, 'utf8').trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, 'hex');
    }
    const key = crypto.randomBytes(32);
    this.writeSecret(this.masterKeyPath, key.toString('hex'));
    return key;
  }

  /** hook token：已存在则复用（避免 CLI hook 配置失效），不存在则生成。 */
  loadOrCreateHookToken(): string {
    if (fs.existsSync(this.hookTokenPath)) {
      const t = fs.readFileSync(this.hookTokenPath, 'utf8').trim();
      if (t.length >= 16) return t;
    }
    const token = crypto.randomBytes(24).toString('hex');
    this.writeSecret(this.hookTokenPath, token);
    return token;
  }

  get hookTokenFile(): string {
    return this.hookTokenPath;
  }

  loadConfig(): StoredConfig {
    if (!fs.existsSync(this.configPath)) return {};
    try {
      const raw = Buffer.from(fs.readFileSync(this.configPath, 'utf8').trim(), 'base64');
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const cipher = raw.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(cipher), decipher.final()]).toString('utf8');
      return JSON.parse(plain) as StoredConfig;
    } catch {
      return {};
    }
  }

  saveConfig(cfg: StoredConfig): void {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    const enc = Buffer.concat([cipher.update(JSON.stringify(cfg), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    this.writeSecret(this.configPath, Buffer.concat([iv, tag, enc]).toString('base64'));
  }

  get deepseekApiKey(): string | undefined {
    return this.loadConfig().deepseek_api_key;
  }
}
