# 宝塔部署说明（Docker 推荐）

适用于全新安装；升级或迁移已有数据先看后面的备份章节。示例域名为 `crm.example.com`，替换成你自己的CRM域名。不要替换同服务器的其他项目。

## 一、准备

1. 域名解析到服务器公网IP。
2. 宝塔中安装Nginx和Docker，确认Docker服务运行。宿主机不用安装新版Node，容器自带Node22。建议现代Ubuntu/Debian；旧系统还需Docker和内核本身兼容。
3. 服务器放行80/443；不要向公网开放3011。确保服务器可以访问GitHub、Docker镜像源和你选用的模型服务。WhatsApp还需要对应网络可达。
4. 准备独立目录，不上传本机客户库、`.env`、授权或Android签名文件。全新线上安装没有默认账号。

## 二、下载代码

在宝塔终端逐行执行（目录不存在时才clone）：

```bash
git clone https://github.com/onesmou/Foreign-Trade-Email-Management-System.git /www/wwwroot/foreign-trade-crm
cd /www/wwwroot/foreign-trade-crm
docker compose build
```

如果服务器无法访问GitHub：在GitHub下载源码ZIP，通过宝塔上传并解压到独立目录；确认该目录直接有`Dockerfile`、`compose.yaml`、`package.json`，再执行构建。不要上传`node_modules`、`.next`或业务`data`。不要用不可信镜像或关闭TLS校验解决下载失败。

## 三、生成配置并启动

仍在项目目录执行（`foreign-trade-crm:v2`是compose.yaml中的镜像名）：

```bash
docker run --rm --network none --user 0:0 -v "$PWD:/config" -w /config --entrypoint node foreign-trade-crm:v2 /app/scripts/init-env.mjs --url https://crm.example.com
docker compose up -d
docker compose ps
docker compose logs --tail=30 crm
curl http://127.0.0.1:3011/api/auth/setup
```

初始化脚本只创建全新`.env`，遇到已存在的文件会拒绝覆盖。它生成独立应用密钥、备份密码和`SETUP_TOKEN`，不在日志输出密钥。最后的接口应返回`needsSetup:true`和`requiresSetupToken:true`；这表示程序启动了，尚需创建管理员。

在宝塔文件编辑器中私下查看`.env`，保存其中`SETUP_TOKEN`和`BACKUP_PASSPHRASE`；首次注册时需要前者，恢复备份需要后者。不要把它们发到GitHub、公开日志或截图中。APP_URL必须是实际HTTPS域名。

只有`docker-compose`旧命令时，把文档中的`docker compose`改为`docker-compose`。默认使用持久化命名卷`crm-data`（Docker会加项目名前缀），保存数据库、上传文件及授权；不要执行`down -v`，不要随意更换Compose项目名或改成空卷。

## 四、给域名单独建站点

1. 宝塔 → 网站 → 添加独立站点/反向代理，域名填`crm.example.com`。不要把CRM域名加到别的项目上。
2. 代理目标填`http://127.0.0.1:3011`，保留原始Host。
3. 只给这个域名申请并部署有效SSL证书，按面板要求由你确认服务条款/验证域名，再开启HTTPS。不能沿用其他站点的证书。
4. 在该站点的反向代理location设置以下选项（由面板生成的重复项不要重复添加）：

```nginx
client_max_body_size 600m;
proxy_read_timeout 180s;
proxy_send_timeout 180s;
proxy_buffering off;
proxy_request_buffering off;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

修改后先检查Nginx配置，再重载。浏览器访问应是CRM，不是其他默认站点；证书应包含CRM域名，不应出现安全警告。不要通过关闭证书校验来使用系统。

## 五、首次使用

1. 打开`https://crm.example.com/setup`。
2. 输入`.env`中的初始化验证码，自己设置管理员邮箱和密码。创建后开放初始化关闭，没有默认线上密码。
3. 在设置填写公司/品牌/签名，添加AI API并测试。测试可能计费，ChatGPT/Codex订阅不等于API额度。
4. 上传公司和产品资料，再录入一封询盘。具体操作见[用户指南](docs/USER_GUIDE.md)。
5. 使用WhatsApp前阅读非官方接入风险，在手机“已关联设备”扫码，不要对真实客户发测试消息。

## 六、网络与WhatsApp代理

默认`WA_PROXY_URL`留空时使用已配置的系统代理。可填可达的HTTP/HTTPS/SOCKS代理，或`direct`强制直连；更改后执行`docker compose up -d`重建服务配置。

Docker中的`127.0.0.1`是容器自己，不是你的电脑，也不自动等于服务器宿主机。不要照抄本机Clash端口；服务器必须有它实际可访问的代理。不要在公开README或日志里放代理账号密码。

## 七、备份与恢复

管理员在设置生成并下载`.ricrmbak`加密备份，密码独立保存。备份包含SQLite一致性快照、私有上传文件和解密所需配置/应用密钥；数据库、头像和聊天图片一起保留。GitHub代码不包含这些数据。

容器中手动备份：

```bash
docker compose exec -T crm node scripts/backup.mjs
```

可将上面命令加到宝塔每日计划任务，但必须先手动验证成功，并异地下载/保存备份。仅存在同服务器的数据卷里，不能防范整机磁盘损坏。默认保留30天且最多30份。

网页恢复：管理员上传备份、输入备份密码和确认文字，验证暂存成功后执行：

```bash
docker compose restart crm
```

恢复前数据保留回滚副本。备份里的`.env`恢复为数据目录内`.env.restore`，不会自动覆盖当前服务器配置；迁移时人工核对APP_SECRET，不能随意生成新密钥覆盖旧密钥。超过网页限制的大备份可通过私有渠道放到服务器，再使用`scripts/restore.mjs`验证/暂存后重启。

## 八、升级，不重建业务数据

先生成并下载加密备份，在原项目目录更新源码、保持同一`.env`和数据卷：

```bash
git pull --ff-only
docker compose build
docker compose up -d
docker compose ps
```

ZIP安装则在备份后只替换源码，保留`.env`和原数据卷。数据库采用增量迁移，升级不需要删库。不要执行`docker compose down -v`、删除数据目录或把本机演示库覆盖到线上。

## 九、常见问题

| 现象 | 先检查 |
| --- | --- |
| 域名打开别的系统 | CRM域名单独的80/443站点、server_name、反代目标、证书；没有匹配站点可能落到默认网站 |
| 502 | `docker compose ps`和容器日志，本机3011是否响应 |
| 初次注册提示验证码错误 | 使用当前服务器.env的SETUP_TOKEN，不是API Key或备份密码 |
| AI流式内容等最后才出现 | Nginx是否关闭proxy_buffering，超时是否足够 |
| 手机回复/附件没有同步 | WhatsApp连接、服务器网络、身份关联和平台实际下发范围；媒体可能过期 |
| 宿主机Node报GLIBC错误 | 优先Docker运行；不要在旧系统强行替换系统glibc |
| 更新后像空系统 | 是否误换了Compose项目名、数据卷或DATA_DIR；先找原数据，不要重置账号 |

## 可选：不使用Docker

现代Linux可用Node22.13+，配置`.env`、`npm ci`、`npm run build`，以普通网站用户运行`npm run start:bt`（127.0.0.1:3011）或项目PM2配置；同样需要独立站点、HTTPS、SETUP_TOKEN和数据备份。生产环境不运行`npm run dev`或演示命令。
