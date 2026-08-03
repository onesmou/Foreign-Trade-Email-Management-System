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
client_max_body_size 100m;
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

## 六、备份与升级

- 每天备份 `data` 整个目录，重点是 `crm.sqlite`、`crm.sqlite-wal`、`crm.sqlite-shm` 和 `.app-secret`。
- API Key 使用应用密钥加密；丢失 `APP_SECRET` 或 `data/.app-secret` 后，已保存的 API Key 无法解密。
- 升级前先备份 `data`，再替换程序文件，执行 `npm ci && npm run build`，最后在宝塔中重启项目。
- 不要把 `.env`、数据库、API Key、客户邮件或资料文件提交到公开仓库。
