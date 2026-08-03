# RehabIntl 邮件询盘客户管理系统

面向康复医疗设备外贸团队的自托管 CRM：粘贴客户整封邮件，自动提取联系人资料，结合公司/产品知识库完成客户分析，并生成英文回复与中文对照。

## 已有功能

- 整封邮件识别：姓名、邮箱、公司、国家、电话、主题、正文和日期。
- AI 服务商：OpenAI、DeepSeek、通义千问、Kimi、豆包、Ollama，以及自定义 OpenAI 兼容接口。
- AI 配置加密保存、真实连接测试、启用模型切换。
- 公司与产品知识库：PDF、DOCX、XLSX、文本、代码文件、ZIP 和文件夹导入。
- Codex/Agent 项目自动过滤依赖、缓存和敏感文件，提取内容后自动归类、分块与检索。
- 回复前自动查找相关公司/产品资料，并记录本次使用的资料来源。
- 中文客户分析、英文回复草稿、中文对照翻译。
- 独立用户系统：管理员、业务员、只读用户，登录限制、密码加密、会话管理、账号停用和密码重置。
- SQLite 本地数据库，适合单机宝塔部署和备份迁移。
- 管理员可一键导出/恢复 AES-256-GCM 加密业务备份，支持SQLite在线安全快照、恢复前回滚副本、自动保留清理和宝塔每日计划任务。

## 本地运行

需要 Node.js 22.13 或更高版本：

```bash
npm ci
npm run dev
```

打开 `http://localhost:3000/setup` 创建首位管理员。

## 生产运行

```bash
npm ci
npm run build
npm run start:bt
```

宝塔部署、Nginx、HTTPS、环境变量和备份步骤见 [DEPLOY_BAOTA.md](./DEPLOY_BAOTA.md)。

## 验证

```bash
npm test
npm audit
```

业务数据默认存放在 `data/`，该目录中的数据库、上传资料和密钥文件不会进入 Git。请对 `data/` 和 `.env` 做独立加密备份。

生产服务器设置 `BACKUP_PASSPHRASE` 后可运行 `npm run backup`，详细的计划任务、异地复制和恢复流程见部署说明。
