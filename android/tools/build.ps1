param([switch]$DebugOnly)
$ErrorActionPreference='Stop'
$androidProject=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$crmProject=[IO.Path]::GetFullPath((Join-Path $androidProject '..'))
$tools=Join-Path $crmProject 'work/android-tools'
$env:JAVA_HOME=Join-Path $tools 'jdk21'
$env:ANDROID_HOME=Join-Path $tools 'sdk'
$temporaryRoot=if($env:CRM_ANDROID_TEMP_DIR){[IO.Path]::GetFullPath($env:CRM_ANDROID_TEMP_DIR)}else{Join-Path ([IO.Path]::GetTempPath()) 'RehabIntlCrmAndroid'}
if($temporaryRoot -match '[^\x00-\x7F]'){throw 'Choose an ASCII-only CRM_ANDROID_TEMP_DIR for Windows Java worker processes.'}
$env:GRADLE_USER_HOME=Join-Path $temporaryRoot 'gradle-cache'
New-Item -ItemType Directory -Force -Path $env:GRADLE_USER_HOME | Out-Null
$oldModules=Join-Path $tools 'gradle-cache/caches/modules-2'
$newCaches=Join-Path $env:GRADLE_USER_HOME 'caches'
if((Test-Path -LiteralPath $oldModules) -and !(Test-Path -LiteralPath (Join-Path $newCaches 'modules-2'))){
  New-Item -ItemType Directory -Force -Path $newCaches | Out-Null
  Copy-Item -LiteralPath $oldModules -Destination $newCaches -Recurse
}
$env:PATH=(Join-Path $env:JAVA_HOME 'bin')+';'+$env:PATH
$gradle=Join-Path $tools 'gradle-8.13/bin/gradle.bat'
if(!(Test-Path -LiteralPath $gradle)){throw 'Run tools/prepare.ps1 first.'}
Push-Location $crmProject
try { & node scripts/android-assets.mjs; if($LASTEXITCODE -ne 0){throw 'Launcher icon generation failed.'} } finally {Pop-Location}
$properties=Join-Path $androidProject 'key.properties'
if(!$DebugOnly -and !(Test-Path -LiteralPath $properties)){
  $keyDir=Join-Path $androidProject '.signing';New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
  $keyFile=Join-Path $keyDir 'release.jks'
  if(Test-Path -LiteralPath $keyFile){throw 'Signing key exists without key.properties. Restore the original properties; do not overwrite the key.'}
  $random=New-Object byte[] 36
  $generator=[Security.Cryptography.RandomNumberGenerator]::Create()
  try{$generator.GetBytes($random)}finally{$generator.Dispose()}
  $password=[Convert]::ToBase64String($random)
  $env:CRM_ANDROID_STORE_PASSWORD=$password
  try {
    & (Join-Path $env:JAVA_HOME 'bin/keytool.exe') -genkeypair -keystore $keyFile -storetype PKCS12 -alias rehabintl-crm -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=RehabIntl CRM, O=RehabIntl, C=CN' '-storepass:env' CRM_ANDROID_STORE_PASSWORD '-keypass:env' CRM_ANDROID_STORE_PASSWORD
    if($LASTEXITCODE -ne 0){throw 'Signing key generation failed.'}
    Set-Content -LiteralPath $properties -Encoding ascii -Value @('storeFile=.signing/release.jks',"storePassword=$password",'keyAlias=rehabintl-crm',"keyPassword=$password")
  }finally{Remove-Item Env:CRM_ANDROID_STORE_PASSWORD -ErrorAction SilentlyContinue;$password=$null}
}
$env:CRM_ANDROID_SIGNING_PROPERTIES=$properties
# Compile a small source-only copy at an ASCII path. Do not copy signing secrets or business data.
$androidBuildProject=Join-Path $temporaryRoot ('build-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path (Join-Path $androidBuildProject 'app') | Out-Null
# ANDROID_HOME supplies the SDK path; do not put Unicode escape sequences into staged local.properties.
foreach($filename in @('settings.gradle','build.gradle','gradle.properties')){Copy-Item -LiteralPath (Join-Path $androidProject $filename) -Destination (Join-Path $androidBuildProject $filename)}
Copy-Item -LiteralPath (Join-Path $androidProject 'app/build.gradle') -Destination (Join-Path $androidBuildProject 'app/build.gradle')
Copy-Item -LiteralPath (Join-Path $androidProject 'app/src') -Destination (Join-Path $androidBuildProject 'app/src') -Recurse
$proxyArgs=@()
$proxyText=if($env:HTTPS_PROXY){$env:HTTPS_PROXY}else{$env:HTTP_PROXY}
if($proxyText){$proxy=[uri]$proxyText;if($proxy.Scheme -eq 'http' -and !$proxy.UserInfo){$proxyArgs=@("-Dhttps.proxyHost=$($proxy.Host)","-Dhttps.proxyPort=$($proxy.Port)","-Dhttp.proxyHost=$($proxy.Host)","-Dhttp.proxyPort=$($proxy.Port)")}}
Push-Location $androidBuildProject
try {
  if($DebugOnly){$tasks=@('testDebugUnitTest','lintDebug','assembleDebug')}else{$tasks=@('testDebugUnitTest','lintRelease','assembleRelease')}
  & $gradle @proxyArgs --no-daemon --console=plain @tasks
  if($LASTEXITCODE -ne 0){throw 'Android build or validation failed.'}
  $variant=if($DebugOnly){'debug'}else{'release'}
  $apk=Join-Path $androidBuildProject "app/build/outputs/apk/$variant/app-$variant.apk"
  if(!(Test-Path -LiteralPath $apk)){throw 'Signed APK output was not found.'}
  $out=Join-Path $crmProject 'outputs/android';New-Item -ItemType Directory -Force -Path $out | Out-Null
  $validation=Join-Path $out 'validation';New-Item -ItemType Directory -Force -Path $validation | Out-Null
  $unitResults=Join-Path $androidBuildProject 'app/build/test-results/testDebugUnitTest'
  if(Test-Path -LiteralPath $unitResults){Copy-Item -LiteralPath $unitResults -Destination (Join-Path $validation 'unit-tests') -Recurse -Force}
  $lint=Join-Path $androidBuildProject "app/build/intermediates/lint_intermediate_text_report/$variant/lintReport$((Get-Culture).TextInfo.ToTitleCase($variant))/lint-results-$variant.txt"
  if(Test-Path -LiteralPath $lint){Copy-Item -LiteralPath $lint -Destination (Join-Path $validation 'android-lint.txt')}
  $name=if($DebugOnly){'RehabIntl-CRM-1.0.0-debug.apk'}else{'RehabIntl-CRM-1.0.0.apk'}
  $target=Join-Path $out $name
  Copy-Item -LiteralPath $apk -Destination $target
  $verify=Join-Path $env:ANDROID_HOME 'build-tools/35.0.0/apksigner.bat'
  & $verify verify --verbose --print-certs $target
  if($LASTEXITCODE -ne 0){throw 'APK signature verification failed.'}
  $hash=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content -LiteralPath ($target+'.sha256') -Value "$hash  $name" -Encoding ascii
  Push-Location $crmProject
  try{& node scripts/android-verify.mjs $target;if($LASTEXITCODE -ne 0){throw 'APK content verification failed.'}}finally{Pop-Location}
  $instructions=Join-Path $out 'INSTALL.txt'
  Copy-Item -LiteralPath (Join-Path $androidProject 'INSTALL.txt') -Destination $instructions
  $bundle=Join-Path $out ($name.Replace('.apk','.zip'))
  Compress-Archive -LiteralPath @($target,($target+'.sha256'),$instructions) -DestinationPath $bundle -Force
  Write-Host "APK ready: $target"
  Write-Host "Phone transfer ZIP: $bundle"
} finally {Pop-Location}
