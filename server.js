// server.js —— 海报重绘网站后端
// 流程：接收上传图(base64) -> 校验 -> 按风格取提示词 -> 调火山方舟 Seedream 图生图 -> 下载结果 -> 返回 URL
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { STYLES, getStyle } from './styles.js';
import { createAccount, getAccount, checkQuota, consumeQuota, listAccounts, resetAccount, deleteAccount, checkAdmin, ADMIN_KEY } from './accounts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const PORT = process.env.PORT || 3000;
const ARK_BASE = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const ARK_API_KEY = process.env.ARK_API_KEY || '';
const DEFAULT_MODEL = process.env.SEEDREAM_MODEL || 'doubao-seedream-5-0-pro-260628';
const MAX_IMAGE_MB = 30;
const RESULT_DIR = path.join(__dirname, 'results');

fs.mkdirSync(RESULT_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '35mb' })); // 放宽以容纳 base64 图片
app.use(express.static(path.join(__dirname, 'public')));
// 把生成结果也作为静态资源暴露（供前端 /results/xxx 访问下载）
app.use('/results', express.static(RESULT_DIR));

// 校验参考图：Ark 要求 宽>14px、像素积≤36M、<30MB、格式 jpeg/png/webp/bmp/tiff/gif/heic/heif
function validateImage(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return '缺少图片数据';
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return '图片必须是 base64 data URI';
  const mime = m[1];
  const valid = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'image/gif', 'image/heic', 'image/heif'];
  if (!valid.includes(mime)) return `不支持的图片格式：${mime}（支持 jpeg/png/webp/bmp/tiff/gif/heic/heif）`;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMAGE_MB * 1024 * 1024) return `图片超过 ${MAX_IMAGE_MB}MB`;
  return null; // 尺寸（宽/像素积）由 Ark 最终校验，此处先放行
}

// 把"原海报尺寸"规整为 Seedream 5.0 Pro 合规输出尺寸：
// 保持原宽高比 + 宽高都是 16 的倍数 + 像素积 ≥921600，且不超过 Ark 上限。
function normalizeSize(origW, origH) {
  const MIN_AREA = 921600;           // 5.0 Pro 显式尺寸最小像素积
  const MAX_SIDE = 2048;             // 5.0 Pro 显式尺寸最长边上限
  const MIN_SIDE = 1280;             // 5.0 Pro 默认最小（实际用面积约束）
  let w = Number(origW) || 1024, h = Number(origH) || 1536;
  if (w < 1 || h < 1) return '1024x1536';
  // 保证面积达标：先求一个缩放因子，使 w*h>=MIN_AREA
  const area = w * h;
  let s = 1;
  if (area < MIN_AREA) s = Math.sqrt(MIN_AREA / area);
  let nw = Math.round(w * s), nh = Math.round(h * s);
  // 限制长边不超过 MAX_SIDE
  const longest = Math.max(nw, nh);
  if (longest > MAX_SIDE) {
    const k = MAX_SIDE / longest;
    nw = Math.round(nw * k); nh = Math.round(nh * k);
  }
  // 规整到 16 的倍数（向下取整，保证 ≤ 计算值）
  nw = Math.max(16, Math.floor(nw / 16) * 16);
  nh = Math.max(16, Math.floor(nh / 16) * 16);
  // 若规整后面积仍不够，微调到达标（加一个 16）
  if (nw * nh < MIN_AREA) {
    if (nw < nh) nw += 16; else nh += 16;
    if (nw * nh < MIN_AREA) nh += 16;
  }
  nw = Math.min(nw, 2048); nh = Math.min(nh, 2048);
  return `${nw}x${nh}`;
}

async function arkGenerate({ prompt, image, size, model }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(`${ARK_BASE}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ARK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || DEFAULT_MODEL, prompt, size, response_format: 'url', watermark: false, image }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const msg = (json?.error?.message || json?.error?.code || json?.message) || text.slice(0, 300) || `HTTP ${res.status}`;
      throw new Error(`Ark API ${res.status}: ${msg}`);
    }
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时（120s），请重试');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadResult(url, id) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下载结果失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const name = `result-${id}.jpg`;
  const dest = path.join(RESULT_DIR, name);
  fs.writeFileSync(dest, buf);
  return { url: `/results/${name}`, path: dest };
}

// 风格列表（前端卡片）
app.get('/api/styles', (_req, res) => {
  const list = Object.entries(STYLES).map(([id, s]) => ({ id, name: s.name, tagline: s.tagline }));
  res.json({ styles: list });
});

// 用户查询自己的额度
app.post('/api/account/me', (req, res) => {
  const { code } = req.body || {};
  const acc = code ? getAccount(code) : null;
  if (!acc) return res.status(404).json({ ok: false, error: '访问码无效' });
  res.json({ ok: true, account: acc });
});

// 管理后台 —— 以下接口需带 adminKey（= .env 的 ADMIN_KEY）
app.post('/api/admin/list', (req, res) => {
  if (!checkAdmin(req.body?.adminKey)) return res.status(401).json({ ok: false, error: '无权限' });
  res.json({ ok: true, accounts: listAccounts() });
});

app.post('/api/admin/create', (req, res) => {
  if (!checkAdmin(req.body?.adminKey)) return res.status(401).json({ ok: false, error: '无权限' });
  const { name, total, code } = req.body || {};
  const acc = createAccount(name, total, code);
  res.json({ ok: true, account: acc });
});

app.post('/api/admin/reset', (req, res) => {
  if (!checkAdmin(req.body?.adminKey)) return res.status(401).json({ ok: false, error: '无权限' });
  const ok = resetAccount(req.body?.code);
  if (!ok) return res.status(404).json({ ok: false, error: '账号不存在' });
  res.json({ ok: true });
});

app.post('/api/admin/delete', (req, res) => {
  if (!checkAdmin(req.body?.adminKey)) return res.status(401).json({ ok: false, error: '无权限' });
  const ok = deleteAccount(req.body?.code);
  if (!ok) return res.status(404).json({ ok: false, error: '账号不存在' });
  res.json({ ok: true });
});

// 重绘
app.post('/api/redraw', async (req, res) => {
  try {
    const { image, style, size, code } = req.body || {};
    // 额度校验
    const quota = checkQuota(code);
    if (!quota.ok) return res.status(403).json({ ok: false, error: quota.error });

    const err = validateImage(image);
    if (err) return res.status(400).json({ ok: false, error: err });
    const styleDef = getStyle(style);
    if (!styleDef) return res.status(400).json({ ok: false, error: `未知风格：${style}` });

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const model = req.body.model || DEFAULT_MODEL;
    const prompt = styleDef.template;
    // 输出尺寸：size=auto（或缺省）时按原海报比例规整；否则用用户手动选的尺寸
    const outSize = (size === 'auto' || !size) ? normalizeSize(req.body.origW, req.body.origH) : size;

    const raw = await arkGenerate({ prompt, image, size: outSize, model });
    const url = Array.isArray(raw?.data) ? raw.data[0]?.url : null;
    if (!url) throw new Error('生成成功但未返回图片 URL');

    const dl = await downloadResult(url, id);
    // 生成成功后才扣额度
    consumeQuota(code);
    const acc = getAccount(code);
    res.json({
      ok: true,
      result: dl.url,
      model: raw.model,
      size: outSize,
      style: styleDef.name,
      used: acc?.used ?? 0,
      total: acc?.total ?? 0,
      remaining: acc?.remaining ?? 0,
    });
  } catch (e) {
    const status = /Ark API 4/.test(e.message) ? 502 : 500;
    res.status(status).json({ ok: false, error: e.message });
  }
});

// 统一错误处理：把 express.json 的 PayloadTooLargeError / 解析错误转成 JSON 友好提示
app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: '图片太大，请压缩到更小尺寸再上传（约 20MB 以内）' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: '请求格式错误（JSON 解析失败）' });
  }
  const status = err.status || 500;
  res.status(status).json({ ok: false, error: err.message || '服务器内部错误' });
});

// 只绑定内网回环地址(127.0.0.1)：由 nginx 反向代理对外，避免 node 直接暴露公网端口
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`海报重绘网站运行中： http://${HOST}:${PORT}`);
  console.log(`样式数量： ${Object.keys(STYLES).length}`);
  if (!ARK_API_KEY) console.warn('⚠️  未设置 ARK_API_KEY，/api/redraw 会失败（见 .env）');
});
