import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL(
    "../android/app/src/main/java/com/rehabintl/crm/MainActivity.java",
    import.meta.url,
  ),
  "utf8",
);
const manifest = readFileSync(
  new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);
test("Android client pins the user-approved HTTPS origin and never embeds backend credentials", () => {
  const gradle = readFileSync(
    new URL("../android/app/build.gradle", import.meta.url),
    "utf8",
  );
  assert.match(gradle, /https:\/\/wmcrm\.jbenlz\.com\//);
  assert.match(manifest, /usesCleartextTraffic="false"/);
  assert.doesNotMatch(
    source,
    /addJavascriptInterface|setAcceptThirdPartyCookies\(browser,true\)|handler\.proceed\(/,
  );
  assert.match(source, /handler\.cancel\(\)/);
  assert.match(source, /setAllowFileAccess\(false\)/);
  assert.match(
    source,
    /setMixedContentMode\(WebSettings\.MIXED_CONTENT_NEVER_ALLOW\)/,
  );
  assert.doesNotMatch(
    manifest,
    /READ_CONTACTS|READ_SMS|MANAGE_EXTERNAL_STORAGE|REQUEST_INSTALL_PACKAGES|CAMERA/,
  );
});
test("Android uploads and private downloads use system pickers and authenticated allowlisted requests", () => {
  assert.match(source, /ACTION_OPEN_DOCUMENT/);
  assert.match(source, /ACTION_CREATE_DOCUMENT/);
  assert.match(source, /if\(!policy\.downloadable\(current\)\)/);
  assert.match(source, /setInstanceFollowRedirects\(false\)/);
  assert.match(source, /setRequestProperty\("Cookie",item\.cookie\)/);
  assert.match(manifest, /allowBackup="false"/);
});
