# NOVA 智能财务目标导航

NOVA 是一个面向个人理财目标规划的响应式前端原型。它围绕“设定目标、评估可行性、应对突发支出”设计交互流程，并用模拟数据展示储蓄进度和目标调整效果。

> 当前版本为前端演示原型，数据保存在页面运行状态中；刷新页面会恢复初始演示数据。它不连接真实银行账户，也不会执行转账或自动扣款。

## 功能概览

- **首页**：查看目标储蓄进度、预计完成日期和每月建议存入金额。
- **创建目标**：查看或调整目标金额、日期、应急金保护额和目标描述。
- **目标可行性**：比较不同月存金额对应的推进节奏。
- **目标影响分析**：模拟汽车保养等突发支出，比较增加月存或延后目标日期两种方案。
- **目标、动态和个人设置**：浏览目标列表、活动信息和演示设置。
- **模拟数据交互**：切换演示情境、调整计划并观察页面反馈。

## 技术栈

- React 19、TypeScript
- Vite 8、Tailwind CSS 4
- lucide-react、Motion

## 本地运行

### 环境要求

- Node.js **20.19 或更高版本**，或 **22.12 或更高版本**
- npm（随 Node.js 安装）

Vite 8 的 Node.js 版本要求见 [Vite 官方文档](https://vite.dev/guide/)。

### 1. 获取项目

此仓库当前为**私有仓库**。队友需要先由仓库管理员邀请为协作者，并接受 GitHub 邀请，之后才能克隆。

```bash
git clone https://github.com/dingxiangyue313/nova-financial-goals.git
cd nova-financial-goals
```

也可以在 GitHub 页面点击 **Code → Download ZIP**，解压后在终端进入项目目录。

### 2. 配置 DeepSeek API（启用智能解析时需要）

复制环境变量模板并填写自己的 API Key：

```bash
cp .env.example .env
``

编辑项目根目录下的 `.env`，设置 `DEEPSEEK_API_KEY`。请勿把真实 API Key 发给队友或提交到 GitHub；每位队友应使用自己的密钥。没有配置密钥时，应用和模拟数据仍可打开，但 DeepSeek 智能解析不可用。

### 3. 安装依赖

```bash
npm install
```

### 4. 启动开发服务器

```bash
npm run dev
```

Vite 会在终端显示本地访问地址。此项目配置的端口为 **3000**，通常可在浏览器打开：

[http://localhost:3000](http://localhost:3000)

启动服务器的终端窗口需要保持运行。结束时回到终端按 **Ctrl+C**。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器 |
| `npm run build` | 生成生产构建文件到 `dist/` |
| `npm run preview` | 由 Vite 本地预览已生成的生产构建 |
| `npm start` | 以 Express 服务端模式运行生产构建（需先运行 `npm run build`） |
| `npm run lint` | 执行 TypeScript 类型检查（`tsc --noEmit`） |

本地查看 Vite 预览版：

```bash
npm run build
npm run preview
```

以服务端模式运行生产构建：

```bash
npm run build
npm start
```

## API Key 与网络说明

应用的基础演示使用代码内置模拟数据。创建目标页的「DeepSeek 智能解析」会把你输入的目标描述发送到 DeepSeek API，并由本地 Node.js 服务端代为请求；API Key 不会发送到浏览器。调用 API 需要自行准备 DeepSeek API Key，费用按 DeepSeek 账户的实际用量规则计算。

页面的字体、图标字体和部分图片通过外部 URL 加载。首次加载这些资源需要联网；离线时应用仍可运行，但部分字体、图标或图片可能无法显示。

## 分享给队友

分享仓库链接：

[https://github.com/dingxiangyue313/nova-financial-goals](https://github.com/dingxiangyue313/nova-financial-goals)

由于仓库为私有，只有已获授权的 GitHub 账号能查看代码和克隆项目。请先在仓库的 **Settings → Collaborators** 中邀请队友；队友接受邀请后，再按“本地运行”步骤操作。
