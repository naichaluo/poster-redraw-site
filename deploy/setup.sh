#!/usr/bin/env bash
# Ubuntu 24.04 一键初始化脚本 —— 在云服务器上执行
# 用法：先 cd 到 poster-redraw-site 目录，再 `sudo bash deploy/setup.sh`
set -euo pipefail

echo "==> [1/5] 安装 Node 20 LTS (NodeSource)"
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
else
  echo "发现已有 node: $(node -v)"
fi
echo "node: $(node -v), npm: $(npm -v)"

echo "==> [2/5] 安装 pm2"
if ! command -v pm2 &>/dev/null; then
  sudo npm i -g pm2
fi

echo "==> [3/5] 安装项目依赖"
npm install --no-audit --no-fund

echo "==> [4/5] 检查 .env"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "已创建 .env，请编辑填写 ARK_API_KEY=ark-你的Key"
fi

echo "==> [5/5] 启动 pm2 并设为开机自启"
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
# 输出开机自启命令（首次运行只需执行一次）
echo -e "请运行下面的命令以设置开机自启:"
sudo pm2 startup | tail -n 1

echo ""
echo "✅ 初始化完成！"
echo "  服务已用 pm2 启动（内网 127.0.0.1:3000）"
echo "  下一步：配置 nginx 反代 + SSL（见 deploy/nginx-poster-redraw.conf 与 DEPLOY.md）"
