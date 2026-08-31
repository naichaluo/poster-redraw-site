// pm2 进程配置 —— 部署时用 `pm2 start ecosystem.config.cjs`
// 注意：项目 package.json 是 "type":"module"，所以用 .cjs(CommonJS) 才能用 __dirname。
const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'poster-redraw',
      script: 'server.js',
      cwd: path.resolve(__dirname), // 以当前目录为工作目录
      instances: 1,                 // 单实例（调用同步 Ark API，无状态）
      exec_mode: 'fork',
      autorestart: true,            // 崩溃自动重启
      watch: false,
      max_memory_restart: '300M',   // 内存超限自动重启
      env: {
        NODE_ENV: 'production',
        // HOST 默认 127.0.0.1（见 server.js），无需在此覆盖
      },
      out_file: './logs/out.log',
      error_file: './logs/err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
