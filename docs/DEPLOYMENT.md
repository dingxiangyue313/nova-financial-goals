# 本地与阿里云部署说明

## 本地备用版

```bash
cp .env.example .env
npm install
npm run dev
```

在 `.env` 中可不填 DeepSeek Key；默认演示地址是 `http://localhost:3000`。服务与前端同源，`data/` 下 SQLite 会话持久化。执行 `npm run lint && npm test && npm run build` 检查可交付版本。

## 发布前准备

### 阿里云账号与服务器权限

不要使用阿里云主账号部署，也不要向部署者发送主账号密码、付款信息、AccessKey 或验证码。账号拥有者应创建一个专用 RAM 子账号（例如 `nova-deploy`），启用控制台登录和 MFA，并只授予：

- 目标 ECS 的管理权限；
- 目标域名的 DNS 修改权限；
- 需要的日志查看权限。

RAM 子账号本身不收费，ECS、域名和网络资源费用仍记在主账号。部署时只使用 RAM 子账号或独立 SSH 密钥；DeepSeek Key 只写在服务器本机 `.env`。

### 域名、网络与备案

为 `nova.<现有域名>` 创建 A 记录，指向 ECS 公网 IP。ECS 安全组只开放 80 和 443；22 只允许维护者的可信 IP。应用的 3000 端口仅绑定在 `127.0.0.1`，不对公网开放。

如果 ECS 位于中国内地，域名正式对外提供服务前需完成 ICP 备案。若 DNS 不在阿里云，请在当前权威 DNS 服务商处创建同样的 A 记录。

部署前由账号拥有者提供以下**非敏感连接信息**：最终子域名、ECS 公网 IP、SSH 用户名、系统版本，以及是否已有 Nginx 或其他反向代理。不要通过聊天发送密码、私钥、API Key 或 MFA 验证码。

## 单容器部署

前提：阿里云 ECS Linux、Docker Compose、指向实例的域名、开放 80/443 入站规则。应用只监听宿主机 `127.0.0.1:3000`，由 Nginx 提供 HTTPS。用独立非 root 账号部署。

```bash
git clone --branch feature/generative-goal-workspace https://github.com/dingxiangyue313/nova-financial-goals.git
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

PWA 在公网必须通过 HTTPS 访问。Nginx 需要让 `/sw.js` 与 `/manifest.webmanifest` 使用 `Cache-Control: no-cache, no-store, must-revalidate`，避免旧 Service Worker 长期滞留；带内容哈希的 `/assets/` 文件可长期缓存。部署新版本后用浏览器确认安装入口、离线只读页和“新版本可用”提示。

## 更新、备份与回滚

- 更新：拉取已评审的 `main`，`docker compose up -d --build`，确认健康检查与关键流程。
- 备份：先执行 `docker compose stop`，备份 `data/nova.sqlite`；恢复前同样停服务，再覆盖数据库并启动。
- 回滚：记录上一版 Git commit，切回后重建容器；若数据库结构已变，先恢复对应备份。
- 重置体验者会话：页面“模拟数据 → 重置”仅清当前会话。全库清理应由维护者在停服后备份并操作，不在网页公开。
- 可用性：服务器断网或 DeepSeek 不可用时，确定性演示仍可完成；外部图片与字体可能缺失。

## 部署验收

访问 `https://<域名>/api/health` 返回 `{"status":"ok","mode":"simulated"}`；手机与桌面打开应用，完成三条链路，刷新页面确认当前会话保存，另一浏览器确认会话隔离。浏览器网络响应、容器日志和 GitHub 不得出现真实 API Key。
