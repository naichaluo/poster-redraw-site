// accounts.js —— 方案A：访问码账号池 + 额度，无数据库，JSON 文件持久化。
// accounts.json 结构：
// {
//   "code": { name, total, used, createdAt },
//   ...
// }
// code 是发给同事的访问码；total 是该码的总次数；used 是已用次数。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, 'accounts.json');

const DEFAULT_TOTAL = 20;            // 默认每账号 20 张
const ADMIN_KEY = process.env.ADMIN_KEY || ''; // 管理后台口令（.env 里配）

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {}; // 首次运行 / 文件不存在 → 空
  }
}

function save(data) {
  // 原子写：先写临时文件再 rename，避免写入中断损坏
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

/** 用随机码生成一个未占用的访问码 */
function genCode(existing) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'; // 去掉易混淆字符
  for (let i = 0; i < 20; i++) {
    let s = '';
    for (let j = 0; j < 8; j++) s += chars[Math.floor(Math.random() * chars.length)];
    if (!existing[s]) return s;
  }
  return `code-${Date.now()}`;
}

/** 创建（或更新）一个账号。返回创建的账号对象。 */
export function createAccount(name, total = DEFAULT_TOTAL, code) {
  const data = load();
  const c = code || genCode(data);
  data[c] = {
    name: name || '未命名',
    total: Number(total) > 0 ? Number(total) : DEFAULT_TOTAL,
    used: 0,
    createdAt: new Date().toISOString(),
  };
  save(data);
  return { code: c, ...data[c] };
}

/** 查询单个账号（不泄漏内部）。 */
export function getAccount(code) {
  const data = load();
  const a = data[code];
  if (!a) return null;
  return {
    code,
    name: a.name,
    total: a.total,
    used: a.used,
    remaining: Math.max(0, a.total - a.used),
    createdAt: a.createdAt,
  };
}

/** 校验访问码是否存在且还有额度。返回 {ok, error?, account?}。 */
export function checkQuota(code) {
  if (!code) return { ok: false, error: '请填写访问码' };
  const data = load();
  const a = data[code];
  if (!a) return { ok: false, error: '访问码无效，请联系管理员' };
  if (a.used >= a.total) return { ok: false, error: `额度已用完（${a.used}/${a.total}），请联系管理员` };
  return { ok: true, account: { code, name: a.name, used: a.used, total: a.total } };
}

/** 生成成功后在额度上 +1。返回是否成功。 */
export function consumeQuota(code) {
  const data = load();
  const a = data[code];
  if (!a || a.used >= a.total) return false;
  a.used += 1;
  save(data);
  return true;
}

/** 列出所有账号（管理后台）。 */
export function listAccounts() {
  const data = load();
  return Object.entries(data).map(([code, a]) => ({
    code,
    name: a.name,
    total: a.total,
    used: a.used,
    remaining: Math.max(0, a.total - a.used),
    createdAt: a.createdAt,
  }));
}

/** 重置某个账号的已用次数（used=0）。 */
export function resetAccount(code) {
  const data = load();
  if (!data[code]) return false;
  data[code].used = 0;
  save(data);
  return true;
}

/** 删除账号。 */
export function deleteAccount(code) {
  const data = load();
  if (!data[code]) return false;
  delete data[code];
  save(data);
  return true;
}

/** 校验管理员口令。 */
export function checkAdmin(key) {
  if (!ADMIN_KEY) return false;
  return key === ADMIN_KEY;
}

export { ADMIN_KEY };
