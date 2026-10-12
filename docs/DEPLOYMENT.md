# 本地与阿里云部署说明

## 本地备用版

```bash
cp .env.example .env
npm ci
npm run dev
```

在 `.env` 中可不填 DeepSeek Key；默认演示地址是 `http://localhost:3000`。服务与前端同源，`data/` 下 SQLite 会话持久化。执行 `npm run lint && npm test && npm run build` 检查可交付版本。

## 单容器部署

前提：阿里云 ECS Linux、Docker Compose、指向实例的域名、开放 80/443 入站规则。应用只监听宿主机 `127.0.0.1:3000`，由 Nginx 提供 HTTPS。用独立非 root 账号部署。

```bash
git clone https://github.com/dingxiangyue313/nova-financial-goals.git
cd nova-financial-goals
cp .env.example .env
```

在服务器本机编辑 `.env`：

- `NOVA_SESSION_SECRET`：独立随机值，建议 `openssl rand -hex 32` 生成后手工写入。
- `NOVA_EXTERNAL_AGENT_SECRET`：外部 Agent HMAC 共享密钥，使用另一份至少 32 字符的随机值并单独轮换。
- `DEEPSEEK_API_KEY`：可留空；若启用模型，填写服务端专用 Key。
- `NOVA_DB_PATH=/app/data/nova.sqlite`，`PORT=3000`。

```bash
mkdir -p data
chmod 700 data
# Dockerfile 使用 node 用户 (UID 1000)。如首次启动遇到 SQLite 权限错误，在服务器执行：
sudo chown -R 1000:1000 data
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
```

按 [Nginx 示例](nginx.nova.conf.example) 替换域名和证书路径，先用 ACME/Certbot 为域名签发有效证书，再启用配置与 HTTPS。不要将 `3000` 端口直接开放到公网。部署前需要确认 ECS 系统版本、SSH 用户、域名和现有反向代理配置；本仓库不包含服务器凭据。

## 更新、备份与回滚

- 更新：拉取已评审的 `main`，`docker compose up -d --build`，确认健康检查与关键流程。
- 备份：先执行 `docker compose stop`，备份 `data/nova.sqlite`；恢复前同样停服务，再覆盖数据库并启动。
- 回滚：记录上一版 Git commit，切回后重建容器；若数据库结构已变，先恢复对应备份。
- 重置体验者会话：页面“模拟数据 → 重置”仅清当前会话。全库清理应由维护者在停服后备份并操作，不在网页公开。
- 可用性：服务器断网或 DeepSeek 不可用时，确定性演示仍可完成；外部图片与字体可能缺失。

## 部署验收

访问 `https://<域名>/api/health` 返回 `{"status":"ok","mode":"simulated"}`；手机与桌面打开应用，完成三条链路，刷新页面确认当前会话保存，另一浏览器确认会话隔离。浏览器网络响应、容器日志和 GitHub 不得出现真实 API Key。
