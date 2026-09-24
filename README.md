# 海报重绘网站（Poster Redraw Site）

上传海报 → 点选风格 → AI 重绘 → 下载。基于火山方舟 **Seedream 5.0 Pro** 图生图 + **31 种海报重绘风格**（RISO 分标准/加强两档，前端共 32 个选项）。

## 功能

- 上传一张海报（jpg/png/webp/bmp/tiff/gif，≤30MB；前端自动压到长边 1600px）
- 点选 31 种风格（32 个选项），每个风格卡片带**真实出图**裁切的缩略图：
  - 原有 19 种：高级撞色、纸艺拼贴、撕纸浮雕、黏土动画、毛绒软萌、吉卜力手绘、蜡笔涂抹、RISO 丝网印刷（标准/加强）、布艺拼接、水彩旅行卡片、厚涂微缩景观、等距治愈积木、纸艺旅行微缩、像素溶解、钢笔淡彩、留白平涂小景、针织毛线、涂鸦马克笔、手账纸胶带拼贴
  - 新增 12 种：**黑白蜡笔速写、复古铜版刻版画、积木玩具花卉、水晶玻璃花卉、羊毛毡花卉杂志、蕾丝刺绣、多巴胺抽象矢量、复古现代版画、几何地标艺术、装饰艺术旅行、分层剪纸、梵高厚涂油画**
- 选择输出尺寸（竖版/横版/方形）
- AI 图生图重绘，尽力保留原海报文字与品牌信息
- 展示结果 + 下载

## 目录结构

```
poster-redraw-site/
├── server.js            # Express 后端（调 Ark + 下载 + 静态托管）
├── styles.js            # 31 种风格的提示词映射（核心，加风格改这里）
├── public/
│   ├── index.html       # 前端单页（零构建，原生 JS）
│   └── thumbs/          # 每个风格一张 420×560 缩略图（真实出图裁切）
├── make_thumbs.py       # 从真实出图裁切生成缩略图（需 Pillow，已 gitignore）
├── results/             # 生成结果临时存放（启动时自动创建）
├── .env.example         # 环境变量模板
├── package.json
└── README.md
```

## 本地运行

```bash
# 1) 装依赖
npm install

# 2) 配置密钥
cp .env.example .env     # Windows: copy .env.example .env
# 编辑 .env，填 ARK_API_KEY=ark-你的Key

# 3) 启动
npm start
# 浏览器打开 http://localhost:3000
```

## 部署到腾讯云

1. **环境**：服务器装 Node.js ≥18（可用 nvm 或 apt/宝塔）。
2. **上传代码**：把整个 `poster-redraw-site` 目录（含 `node_modules`）上传到服务器，或用 git / 宝塔一键部署。
3. **安装**：`npm install`，建 `.env` 填 `ARK_API_KEY`。
4. **常驻运行**：用 `pm2`（推荐）保持进程存活：
   ```bash
   npm i -g pm2
   pm2 start server.js --name poster-redraw
   pm2 save && pm2 startup
   ```
5. **反向代理 + HTTPS**（强烈建议）：用 **Nginx** 把 80 端口转发到 `localhost:3000`，并启用腾讯云免费 SSL 证书（https），这样浏览器能安全上传/下载图片。
   ```nginx
   server {
     listen 80;
     server_name yourdomain.com;
     location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
   }
   ```
   申请证书后在 `listen 443 ssl` + 证书路径。

6. **域名解析**：把 `yourdomain.com` A 记录指向你服务器公网 IP（腾讯云 DNSPod）。**国内服务器域名需已 ICP 备案**。

## 安全与费用注意

- **API Key 只放后端**（`.env`），绝不放进前端脚本。
- 图片生成**按张计费**，建议后端加**限流/计数**（或在 Nginx 层限制），避免被滥用烧钱。
- 生成结果 URL 24 小时有效，本服务启动时即时下载到 `results/`；请定时清理该目录防占磁盘。
- 输出尺寸需满足 5.0 Pro：宽高均为 16 的倍数、像素积 ≥921600（前端已内置合规尺寸）。

## 加 / 改风格

编辑 `styles.js`，给 `STYLES` 加一条即可，前端卡片会自动出现：

```js
'my-style': {
  name: '我的风格',
  tagline: '一句话说明',
  template: '以源海报为唯一参考做风格重绘，务必保留主体与全部文字…改为XX风…',
},
```

> 提示词模板来自各 Skill 的 `prompt-templates.md`，强调"保留商业内容 + 文字两层处理"。

**加风格要做两件事**（只做第一件的话卡片会没有缩略图）：

1. 在 `styles.js` 的 `STYLES` 里加一条（`STYLE_ORDER` 自动跟随 `Object.keys`，顺序即插入顺序）。
2. 在 `make_thumbs.py` 的 `SRC` 里加一条 `"<style-id>": r"源图相对路径"`，然后 `python make_thumbs.py` 生成 `public/thumbs/<style-id>.jpg`。

`/api/styles` 会用 `fs.existsSync` 校验缩略图是否存在，不存在则 `thumb` 返回 `null`，前端卡片会退化成无图状态——所以加完风格记得跑一次 `make_thumbs.py`。

## 已知问题

- **出图偶发超时**：`server.js` 里对 Ark 的请求硬编码了 120 秒超时，而 Ark 实际延迟在 20 秒到 120 秒以上波动，慢的那次会被掐断、用户看到"请求超时（120s）"。Nginx 侧 `proxy_read_timeout` 是 180s。修法：把两处都调大（Nginx 必须大于 Node），或改成异步任务模式（`POST /api/redraw` 立刻返回 jobId，前端轮询状态）。
- `results/` 只增不减，长期运行需定时清理。
