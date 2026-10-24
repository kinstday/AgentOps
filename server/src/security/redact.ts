/** 日志脱敏（§8.2）：Bearer / token / sk- 密钥不进入日志。 */

export function redactSecrets(input: string): string {
  return input
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1***')
    .replace(/\b(sk-[A-Za-z0-9]{3})[A-Za-z0-9._-]+/g, '$1***')
    .replace(/([?&](?:token|key|api_key|apikey)=)[^&\s]+/gi, '$1***')
    .replace(/("(?:deepseek_api_key|api_key|token|master_key)"\s*:\s*")[^"]+/gi, '$1***');
}

function fmt(args: unknown[]): unknown[] {
  return args.map((a) => (typeof a === 'string' ? redactSecrets(a) : a));
}

export const log = {
  info: (...args: unknown[]) => console.log(...fmt(args)),
  warn: (...args: unknown[]) => console.warn(...fmt(args)),
  error: (...args: unknown[]) => console.error(...fmt(args)),
};
