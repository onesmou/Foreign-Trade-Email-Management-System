# 外贸客户 AI 工作台 / Foreign Trade CRM

一个可自行部署的轻量 CRM：把客户邮件、普通 WhatsApp 沟通、客户记忆和产品资料放到同一份档案，让 AI 帮你整理进度、自动找资料、准备双语回复。

A self-hosted customer workspace for trade teams: email/WhatsApp continuity, shared product files, customer memory and AI-assisted replies. Chinese-first UI; bring your own model API.

不必为每位客户在 Codex 反复开新对话。本系统不是自动群发或无人值守成交机器人，报价、承诺及回复需要人工复核。

## 主要功能

| 模块 | 用途 |
| --- | --- |
| 工作台 | 最近客户、到期跟进和下一步动作 |
| 客户档案 | 粘贴邮件全文识别联系人；复用已有客户；一位客户管理多个采购项目 |
| 客户 AI | 连续对话、客户记忆、自动检索有权限的产品资料，生成客户语言回复与中文对照 |
| 图片对话 | Ctrl+V、拖入或选择图片；预览和移除；按客户/项目隔离保存 |
| 文件夹资料库 | 公司/产品/图片文件夹，整文件夹或ZIP上传，原件、版本、权限和AI内容分类 |
| 普通 WhatsApp | 扫码关联、私聊收件箱、客户归档、人工确认文字回复、头像和附件下载 |
| 来源与接入 | 邮件、WhatsApp、网站、广告、展会等渠道；来源专属咨询表单和服务端入口 |
| 管理与备份 | 公司品牌/Logo，管理员/销售/只读账号，客户授权，加密备份与恢复 |

客户页三栏支持拖动宽度和独立全屏，提供响应式网页。另有 [Android 客户端源码](android/README.md)，不是 iOS App。

## 使用前请了解

- 模型 API 需要自己的接口和额度，可能计费。支持 OpenAI、DeepSeek、通义千问、Kimi 等预设和自定义兼容中转接口；模型是否可用取决于服务商和账号权限。ChatGPT/Codex 订阅不是本系统的 API 额度，也不会自动带入其历史对话。
- 看图需要当前对话模型支持图像输入，自动检索工具需要接口支持工具调用。文本连接成功不代表全部能力都可用。
- 普通 WhatsApp 使用非官方 Baileys 连接，不是 Meta 官方商业 API。可能断线、历史不全、媒体过期或账号受限，请评估后使用。未关联私聊仅管理员可见，选定业务聊天才进入客户档案。头像受隐私限制，不能保证同步全部历史。
- WhatsApp 支持人工确认文字发送，暂不支持发送附件、自动回复和群发。邮件主要是全文录入、入站接口及草稿准备，不是完整的 IMAP/SMTP 邮箱客户端；生成草稿不等于发送。
- 扫描件/图片识别需要合适的视觉模型。低置信度资料保留待审核；上传成功不等于识别成功。AI 不应编造价格、库存、认证或交期。
- 附件下载单件最多50MB；旧消息缺少下载信息或媒体过期时，可能需要平台重新下发或客户重发。阅后即焚媒体不保存。

## 线上安装：推荐 Docker + 宝塔

准备 Linux 服务器、正常运行的 Docker/Compose、Nginx 和独立域名。容器默认只监听服务器本机 `127.0.0.1:3011`，再由 Nginx 提供 HTTPS。

逐步操作见 [宝塔部署说明](DEPLOY_BAOTA.md)。首次公开部署必须生成 `SETUP_TOKEN` 保护初始化入口，然后打开 `https://你的域名/setup`，输入验证码并自己创建管理员。没有默认线上账号或密码。

配置公司、AI、资料库和第一位客户，见 [用户指南](docs/USER_GUIDE.md)。

## 本地试用 / 开发

运行环境最低 Node.js 22.13；开发和测试建议 Node.js 24。

```bash
git clone https://github.com/onesmou/Foreign-Trade-Email-Management-System.git
cd Foreign-Trade-Email-Management-System
npm ci
npm run build
npm run preview
```

打开 `http://127.0.0.1:3011/`。仅全新本机演示库使用 `preview@local.test` / `PreviewCRM2026!`，不能用作线上账号。数据位于 `data/v2-preview/`；若此目录已使用，命令复用原数据和授权，不会重置。确认没有连接真实 WhatsApp 后再发送测试消息。

正式本地使用应配置 `.env.example` 中的独立数据目录、APP_URL和密钥，用 `npm run build`、`npm start`，自行初始化管理员，不使用演示账号。

## 数据与备份

- GitHub 是代码版本库，不是客户业务备份。仓库不包含 `.env`、数据库、聊天、上传资料、API Key、WhatsApp 授权、加密备份或 Android 签名密钥。
- 运行数据为 SQLite + 私有上传目录。口令使用哈希，API Key和WhatsApp凭据由应用密钥加密。
- 在设置生成 `.ricrmbak` 加密备份，保存备份密码并异地存放；`APP_SECRET` / `data/.app-secret` 与上传目录也需保护。
- Docker使用持久化数据卷。不要执行 `docker compose down -v`，也不要升级时换成空目录或新卷。
- 模型服务商会收到提交给它的文本和图片，请评估中转站的数据处理政策，谨慎授权内部文件。

详见 [安全说明](SECURITY.md) 和 [部署中的备份/升级步骤](DEPLOY_BAOTA.md)。

## 测试与文档

```bash
npm run build
node --test tests/*.test.mjs
```

测试使用临时数据库和模拟 AI/WhatsApp，不依赖真实客户或模型额度。真实账号、第三方模型能力、服务器网络和安卓实机应单独验收。

技术栈：Next.js、React、TypeScript、SQLite、AI SDK、Baileys、Sharp，以及文档/表格解析组件。

[使用指南](docs/USER_GUIDE.md) · [宝塔部署](DEPLOY_BAOTA.md) · [Codex历史导入](docs/CODEX_IMPORT.md) · [开发与贡献](CONTRIBUTING.md) · [Android](android/README.md)

## 许可证

源码使用 [MIT License](LICENSE)。客户数据、用户上传的公司资料和第三方商标不因本许可转为公开内容；第三方依赖保留各自许可证。本项目不是 WhatsApp、Meta、OpenAI 或 Codex 的官方产品。
