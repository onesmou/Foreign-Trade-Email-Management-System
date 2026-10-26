# RehabIntl CRM 安卓客户端（源码）

> 自行部署者请先修改 `android/app/build.gradle` 的 `CRM_URL` 为自己的 HTTPS 地址，并同步测试中的地址断言。独立发行请使用自己的包名、应用名称、图标和签名；维护者域名不是公共免费服务。仓库不分发 APK 或私有签名。下方的构建记录是 2026-10-25 的历史验收记录，不代表当前服务器状态。

连接地址：**https://wmcrm.jbenlz.com/**（用户于 2026-10-25 确认）。主要面向小米 15 等近期安卓手机，安装最低要求 Android 8，实际页面兼容性还取决于系统 WebView。

这是轻量安卓联网客户端，复用手机内置 WebView 与线上 CRM，不是离线数据库或完全重写的原生业务界面，因此安装包体积较小。

## 使用和安装

1. 在电脑取得 `outputs/android/RehabIntl-CRM-1.0.0.apk`，通过你信任的文件传输方式发到手机。也可传同目录的 ZIP 后解压。
2. 在手机文件管理中打开 APK，按系统提示允许这一次或这个下载来源安装。不需要关闭全局安全扫描、不需要 root；若厂商拦截，请保留提示截图再排查。
3. 打开桌面的“RehabIntl CRM”，使用线上 CRM 的邮箱和密码登录。每位同事使用自己的账号，不共用管理员密码。

App 显示的是**你配置的服务器上已部署的 CRM**，不是电脑 `127.0.0.1:3011` 的预览。电脑网页和手机共享线上数据、用户权限和 AI 配置。先完成网页版部署，再使用 App；仅安装 App 不会部署服务器或迁移本机数据。

### 必须先确认 HTTPS

服务器证书必须有效、与域名匹配且链完整。App 会拒绝证书错误的连接，不提供绕过按钮。

请在宝塔中为 `wmcrm.jbenlz.com` 绑定有效、域名匹配、证书链完整的 HTTPS 证书，并确认该 HTTPS 站点反向代理到正确的 CRM 容器。证书修正后重新连接即可，无需为了证书续期重打 APK。尚未在用户的小米 15 真机上验收；网络和证书结果也需要手机侧确认。

## 本版范围

- 独立桌面图标启动、服务器地址显示、返回键、回到工作台和刷新确认。
- 复用已上线的手机网页布局、账号、客户/项目、AI 助手、资料和 WhatsApp 页面；不另建本地客户数据库。
- 系统文件选择器支持单选/多选文件；选目录请先打 ZIP。原文件下载保留登录权限，使用系统保存位置选择器；不把私人 PDF 上传给在线第三方阅读器。
- 断网、服务错误和证书错误使用中文提示；外部 HTTPS、电话、邮件链接需用户确认后在其他应用打开。
- 仅声明联网权限，没有通讯录、短信、相机、读取全盘或安装其他应用权限。
- 不包含离线资料、后台系统推送、直接拍照上传、生物识别登录或自动安装升级。App 打开时的数据刷新沿用服务器功能；Android 回收进程可能丢失尚未提交的文字。
- 手机桌面名称和图标来自安装包；CRM 公司信息中的品牌调整只影响软件内部，不会动态改变手机桌面图标。

## 开发和打包（Windows）

需要 Node.js（先在 CRM 根目录安装依赖）。在 CRM 根目录运行：

```powershell
# 仅在阅读并同意 Android SDK 使用许可之后加此参数。
powershell -NoProfile -File android/tools/prepare.ps1 -AcceptSdkLicense
powershell -NoProfile -File android/tools/build.ps1
```

工具来自 Google、Microsoft、Gradle 官方站点，下载后验证 SHA-256。JDK、SDK、Gradle 在忽略的 `work/android-tools/`；不修改全局系统环境。编译源代码副本及 Gradle 缓存在系统临时目录 `RehabIntlCrmAndroid/` 的英文路径下，解决 Windows Java 工作进程读取中文路径的兼容问题；不复制签名私钥或业务数据到该副本。可用进程环境变量 `CRM_ANDROID_TEMP_DIR` 指定其他英文临时目录。使用 Gradle 8.13 / AGP 8.13.2、SDK 36、JDK 21（源码目标 Java 17），无原生第三方运行库。

打包脚本运行纯 Java 单元测试、Android Lint、release 编译和 APK 签名验证。额外安全回归：`node --test tests/android-client.test.mjs`。没有真机或模拟器截图时，不把“编译通过”描述成“小米实机已验证”。

### 本次生成及验证（2026-10-25）

- 已生成 release APK 和便于传输的 ZIP：`outputs/android/RehabIntl-CRM-1.0.0.apk`、`outputs/android/RehabIntl-CRM-1.0.0.zip`。
- 包名 `com.rehabintl.crm`，版本 1.0.0（versionCode 1），minSdk 26 / targetSdk 36；实际包只声明 INTERNET 权限。
- 4 项安卓单元测试通过，Android Lint 为 0 错误、3 个兼容/图标提示（旧版忽略的返回属性、与最低 SDK 相同的资源目录限定、可选单色主题图标）；没有关闭发布 Lint 或跳过测试。旧系统返回键的单项提示因已有 API33+ 平台回调而做了局部注释说明，不是关闭全部手势检查。
- 现有 CRM 及新增安卓静态安全检查共 20 项通过；APK 的 v2 签名验证通过。发布包不使用 debug 包名或调试签名。
- APK 内容检查未发现数据库、环境配置或签名文件；中文字节码与指定服务器地址均核验。校验记录在同目录 `.verification.json`；原生测试报告在 `outputs/android/validation/`。
- 未连接小米 15 真机，未验证手机上的实际登录、键盘、文件选择和保存；线上 TLS 域名不匹配仍未修复。未上传 GitHub、发布市场或更新宝塔。

### 升级签名文件：务必保管

首次正式打包会在本机产生 `android/.signing/release.jks` 和 `android/key.properties`。这两个是**私密升级签名材料**，已忽略、不打进 APK、不放 GitHub，不属于 CRM 数据库备份。

请单独做受保护的离线备份，勿将它们与安装包一起发给同事。后续升级须沿用这套签名并增加 `app/build.gradle` 的 versionCode；丢失签名可能无法覆盖安装升级。脚本发现签名文件异常时停止，不自动覆盖旧密钥。

## 设计依据

- [Android WebView 安全](https://developer.android.com/privacy-and-security/security-tips)
- [不得继续连接有 SSL 错误的页面](https://developer.android.com/reference/android/webkit/WebViewClient#onReceivedSslError(android.webkit.WebView,%20android.webkit.SslErrorHandler,%20android.net.http.SslError))
- [Android 内部安装包分发](https://developer.android.com/distribute/marketing-tools/alternative-distribution)

该内部版未上架应用市场，分发/开发者验证条件以设备和所在地现行要求为准。
