# 上线与调试指南（Poster Redraw Site）

本项目当前在本地 Windows 跑（`http://localhost:3310`）。上线 = 把代码搬到**腾讯云服务器**(Ubuntu 24.04)，用 **pm2 常驻 + nginx 反代 + SSL + 子域名** 对外，然后做全链路调试。

> 本方案：新网站用**子域名 `poster.taizhongtxl.cn`**，你已有的静态网页(`taizhongtxl.cn`)保持不动，新旧互不干扰。域名**已 ICP 备案**(主体：罗君)✅，可直接复用；SSL 旧证书**已过期**，需重新签发。

---

## 一、你的资产清单

| 项 | 状态 |
|---|---|
| 云服务器 | ⏳ 待购买（4核4G + 40G SSD + 5Mbps + 500G流量，188元/年，Ubuntu 24.04） |
| 公网 IP | 买服务器后自动分配，从控制台实例列表复制 |
| 域名 `taizhongtxl.cn` | ✅ 已备案，复用 |
| 子域名 `poster.taizhongtxl.cn` | 用 DNSPod 加一条 A 记录指向新服务器 IP |
| SSL 证书 | ⚠️ 旧证书已过期，需重新签发（绑定 `poster.taizhongtxl.cn`） |
| 已有静态网页 | 保持 `taizhongtxl.cn` 不动，不受影响 |

---

## 二、购买服务器（Ubuntu 24.04）

1. 腾讯云控制台 → 云服务器/轻量 → **4核4G + 40G SSD + 5Mbps + 500G流量(188元/年)**
2. 系统镜像：**Ubuntu Server 24.04 LTS**
3. 安全组放行：**22 (SSH)、80、443**；不要放行 3000/3310
4. 下单 → 开通，复制**公网 IP**

---

## 三、服务器初始化（一键脚本）

上传代码到服务器（如 `/var/www/poster-redraw-site`），然后：

```bash
cd /var/www/poster-redraw-site
sudo bash deploy/setup.sh
```

脚本会自动：装 Node 20 LTS → 装 pm2 → 装项目依赖 → 生成 `.env`(需你填 Key) → 用 pm2 启动并设为开机自启。

完成后手动把 `.env` 的 `ARK_API_KEY` 填成真实 Key：

```bash
nano .env   # ARK_API_KEY=ark-你的Key；PORT=3000
pm2 restart poster-redraw
```

---

## 四、域名解析（DNSPod 加子域名 A 记录）

给子域名 `poster` 加一条记录，指向新服务器公网 IP：

| 主机记录 | 类型 | 记录值 |
|---|---|---|
| `poster` | A | `你的公网IP` |

- **不要动** `taizhongtxl.cn`(保旧站) 和 `www` 的现有解析。

---

## 五、重新签发 SSL 证书（绑定子域名）

旧证书已过期。重新申请腾讯云免费 DV 证书，**绑定 `poster.taizhongtxl.cn`**(如需 `www.poster` 一并加 SAN)。签发后下载 nginx 版本，上传到服务器 `/etc/nginx/ssl/`。

把 `deploy/nginx-poster-redraw.conf` 里的证书路径改成实际路径，然后：

```bash
sudo apt install -y nginx
sudo cp deploy/nginx-poster-redraw.conf /etc/nginx/sites-available/poster-redraw
sudo ln -s /etc/nginx/sites-available/poster-redraw /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 六、上线后调试清单

| 检查项 | 做法 | 预期 |
|---|---|---|
| 服务在线 | `pm2 status` | `poster-redraw online` |
| 内网可访问 | `curl http://127.0.0.1:3000/api/styles` | 返回 10 个风格 JSON |
| HTTPS 可访问 | 浏览器打开 `https://poster.taizhongtxl.cn` | 见上传页 + 锁标 |
| 前端→后端→Ark | 上传图 → 选风格 → 重绘 | 出结果 |
| 下载 | 点结果图下载 | 图片保存 |

> 若打不开：先 `curl http://127.0.0.1:3000/api/styles` 确认 node；再 `curl -I https://poster.taizhongtxl.cn` 确认 nginx/证书；`pm2 logs` 看报错。

---

## 七、上线后注意事项

- **限流**：图片按张计费，建议加限流防刷（nginx `limit_req` 或后端计数）。
- **清理**：`results/` 临时图定期清理（cron 跑清理脚本）。
- **安全**：`.env`(含 API Key) 勿提交 git / 勿被 nginx 暴露。
- **监听**：server.js 已改绑定 `127.0.0.1`，node 不暴露公网，仅内网由 nginx 转发。

---

## 八、本地上线前安全改动（已改）

`server.js` 的 `listen` 已是 `127.0.0.1`（只绑回环，由 nginx 反代），防止 node 直接暴露公网端口。
