import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { KeyStore } from '../src/security/secrets.js';

/**
 * 首次启动引导：写入 DeepSeek API Key 到 ~/.agentops/config.enc（AES-256-GCM）。
 * 用法：npm run setup:key
 */

const rl = readline.createInterface({ input: stdin, output: stdout });
const keystore = new KeyStore();

const existing = keystore.deepseekApiKey;
if (existing) {
  console.log(`当前已配置 DeepSeek API Key（${existing.slice(0, 6)}***），输入新值将覆盖。`);
}

const key = (await rl.question('请输入 DeepSeek API Key（留空取消）: ')).trim();
rl.close();

if (!key) {
  console.log('已取消，未做修改。');
  process.exit(0);
}

const cfg = keystore.loadConfig();
cfg.deepseek_api_key = key;
keystore.saveConfig(cfg);
console.log('已加密写入 ~/.agentops/config.enc。重启服务后 DeepSeek 配额将切换为真实采集。');
