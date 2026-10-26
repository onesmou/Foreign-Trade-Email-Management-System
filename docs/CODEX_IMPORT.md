# Codex 客户历史导入

这是管理员执行的一次性导入，不是扫描所有Codex聊天的后台爬虫，也不共享订阅/API额度。

先把获授权历史整理为 bundle JSON 和原文件目录，格式参考 [最小虚构示例](../examples/customer.bundle.json)；不能保证任意原始日志未经整理直接导入。示例没有客户原话、记忆及附件，因而这三项为空数组，不能把 AI 讨论冒充客户消息。

有附件时，每个 `files` 条目需要相对路径 `path`、文件内容的 `sha256`、`scope`（customer/internal）、`role`（reference/incoming/draft/internal/approved）和明确的 `canSend`。仅审核批准的客户可发文件才设为 true，内部成本文件始终为 false。完整带附件样例及回滚测试见 `tests/codex-migration.test.mjs`。覆盖统计必须真实，不能为了导入把未读取分页标成完整。

同一客户复用档案，多采购项目分开；保留“用户与AI讨论”的来源，不把AI建议当客户原话。草稿不是发送证明，推定发送不等于投递回执。内部文件不能当客户可发附件。

使用Node.js24，目标库已初始化且有管理员，先预览：

```bash
node scripts/migrate-codex.mjs --bundle /private/import/customer.bundle.json --source-root /private/import/files --database /private/crm-data/rehabintl-crm.sqlite --admin-email admin@example.com
```

核对客户、项目、文件和来源，先做完整备份，再在相同命令末尾加`--apply`写入。重复导入有幂等检查，不会盲目覆盖已变更清单。

管理员在客户“Codex历史”标签查看讨论，已核对记忆供后续AI使用。清单、日志、原文件、导入快照均属于私有数据，不提交公开仓库。导入快照不替代包含密钥和上传文件的完整加密备份。
