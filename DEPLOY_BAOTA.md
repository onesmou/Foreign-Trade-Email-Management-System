# 询盘客户管理系统：宝塔部署说明

## 一、服务器准备

- 建议使用 Ubuntu 22.04/24.04 或 Debian 12。
- 宝塔安装：Nginx、Node.js 版本管理器、PM2 管理器。
- Node.js 使用 **22.13 或更高版本**。
- 给系统准备一个独立域名，例如 `crm.example.com`，并提前解析到服务器。

## 二、上传与安装

1. 把项目上传到独立目录，例如 `/www/wwwroot/rehabintl-crm`。
2. 不要上传本机的 `node_modules`、`.next`、`.git`、`.npm-cache` 和 `data` 中的实际业务数据。
3. 在项目目录执行：

   ```bash
   npm ci
   npm run build
   ```

4. 复制 `.env.example` 为 `.env`，至少修改：

   ```env
   DATA_DIR=/www/wwwroot/rehabintl-crm/data
   APP_URL=https://crm.example.com
   APP_SECRET=请填写至少32位随机字符串
   ALLOW_LOCAL_AI=0
   INBOUND_EMAIL_SECRET=如不使用邮件入站接口可留空
   BACKUP_PASSPHRASE=请设置至少12位且包含字母和数字的独立备份密码
   BACKUP_RETENTION_DAYS=30
   BACKUP_RETENTION_COUNT=30
   BACKUP_COPY_DIR=/mnt/backup/rehabintl-crm
   ```

5. 确认 `data` 目录可由运行 Node.js 的用户写入。这里保存客户、询盘、用户和加密后的 AI 配置，必须定期备份。

## 三、在宝塔启动

在“Node 项目”中新建项目：

- 项目目录：`/www/wwwroot/rehabintl-crm`
- 启动方式：`npm`
- 启动命令：`npm run start:bt`
- 端口：`3000`
- Node 版本：22.13+
- 运行用户：建议使用普通网站用户，不要使用 root

也可以用项目自带的 `ecosystem.config.cjs` 交给 PM2 启动。应用只监听 `127.0.0.1:3000`，不应把 3000 端口直接暴露到公网。

## 四、Nginx 与 HTTPS

在宝塔网站设置中添加反向代理，把域名转发到 `http://127.0.0.1:3000`，然后申请并强制开启 HTTPS。Nginx 站点配置中建议加入：

```nginx
client_max_body_size 600m;
proxy_read_timeout 180s;
proxy_send_timeout 180s;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

## 五、第一次使用

1. 浏览器打开 `https://crm.example.com/setup`。
2. 创建第一个管理员账号；初始化完成后该页面不能再次创建管理员。
3. 登录后打开“系统配置 → AI 模型”。
4. 选择 DeepSeek、通义千问、Kimi、豆包、OpenAI 或自定义兼容接口，填写 API Key，先点“测试连接”，成功后保存并启用。
5. 在“公司信息”填写公司资料，在“产品与公司资料库”上传产品文档、PDF、Word、Excel、图片说明或 Codex/Agent 项目 ZIP/文件夹。

## 六、自动加密备份

系统生成的 `.ricrmbak` 文件包含数据库、客户邮件、用户、AI配置、上传资料、`data/.app-secret` 和服务器 `.env`，整个文件使用独立备份密码加密。数据库通过 SQLite `VACUUM INTO` 在线生成一致性快照，不直接复制运行中的 WAL 数据库。

1. 在 `.env` 设置 `BACKUP_PASSPHRASE`。请把密码保存在公司密码管理器中；丢失后无法解密备份。
2. 如果服务器挂载了另一块磁盘或 NAS，把路径填入 `BACKUP_COPY_DIR`。不填写时只保存在 `data/backups/`，无法防范整台服务器磁盘损坏。
3. 在项目目录手动验证：

   ```bash
   npm run backup
   ```

4. 在宝塔“计划任务 → Shell脚本”中新增每日任务，例如每天凌晨02:30执行：

   ```bash
   cd /www/wwwroot/rehabintl-crm && npm run backup >> /www/wwwlogs/rehabintl-crm-backup.log 2>&1
   ```

5. 计划任务必须使用与Node项目相同的网站用户运行，并确保该用户可写 `DATA_DIR`、`data/backups/` 和 `BACKUP_COPY_DIR`，否则会出现权限错误。
6. 如果计划任务提示找不到 `npm`，在宝塔Node项目终端运行 `which npm`，把上面命令中的 `npm` 替换成返回的完整路径。
7. 建议另外使用宝塔对象存储、云存储插件或挂载NAS，把加密后的 `.ricrmbak` 文件异地保存。

保留规则由 `BACKUP_RETENTION_DAYS` 和 `BACKUP_RETENTION_COUNT` 同时控制，默认保留30天且最多30份，至少始终保留最新一份。

## 七、恢复与回滚

1. 登录管理员账号，打开“系统配置 → 备份恢复”。
2. 上传 `.ricrmbak` 文件，输入创建备份时使用的密码，并输入“确认恢复”。
3. 系统只会先完成解密、路径检查、数据库结构检查和完整性校验，不会立即覆盖运行中的数据。
4. 验证成功后，立即在宝塔中重启Node项目。恢复会在数据库打开前完成。
5. 恢复前数据会保留在 `data/recovery-before-restore-日期时间/`，确认恢复结果无误后再人工清理。
6. 备份里的 `.env` 会恢复为 `data/.env.restore`，不会自动覆盖服务器当前 `.env`。如迁移到新服务器，请人工比较后配置，尤其是自定义 `APP_SECRET`。
7. 超过512MB的备份请上传到服务器后执行 `npm run restore -- /备份文件绝对路径/backup-xxx.ricrmbak`，验证成功后再重启Node项目。

## 八、升级注意事项

- 升级前先在管理界面下载一份加密备份，再替换程序文件，执行 `npm ci && npm run build`，最后重启项目。
- API Key 使用应用密钥加密；丢失 `APP_SECRET` 或 `data/.app-secret` 后，已保存的 API Key 无法解密。
- 不要把 `.env`、数据库、API Key、客户邮件、上传资料或 `.ricrmbak` 文件提交到GitHub。
