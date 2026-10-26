param([switch]$AcceptSdkLicense)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$androidProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$crmProject = [IO.Path]::GetFullPath((Join-Path $androidProject '..'))
$toolRoot = Join-Path $crmProject 'work/android-tools'
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
function Get-VerifiedArchive([string]$Url,[string]$Name,[string]$Checksum) {
  $target = Join-Path $toolRoot $Name
  if ((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $Checksum.Trim()) {
    $preserved = "$target.incomplete-$([guid]::NewGuid().ToString('N'))"
    Move-Item -LiteralPath $target -Destination $preserved
  }
  if (!(Test-Path -LiteralPath $target)) {
    Write-Host "Downloading $Name from official vendor..."
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
      & $curl.Source --fail --location --retry 4 --retry-all-errors --retry-delay 2 --connect-timeout 30 --max-time 900 --silent --show-error --output $target $Url
      if ($LASTEXITCODE -ne 0) { throw "Official download failed: $Name" }
    } else { Invoke-WebRequest -Uri $Url -OutFile $target -TimeoutSec 900 }
  }
  $actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
  if ($actual -ne $Checksum.Trim()) { throw "SHA-256 mismatch for $Name. Archive was not executed." }
  return $target
}
function Read-OfficialHash([string]$Url) {
  $value = (Invoke-WebRequest -Uri $Url -TimeoutSec 60).Content
  if ($value -is [byte[]]) { $value = [Text.Encoding]::UTF8.GetString($value) }
  $match = [regex]::Match([string]$value,'(?i)[a-f0-9]{64}')
  if (!$match.Success) { throw 'Official checksum was unavailable.' }
  return $match.Value
}
$jdkFolder = Join-Path $toolRoot 'jdk21'
if (!(Test-Path -LiteralPath (Join-Path $jdkFolder 'bin/java.exe'))) {
  $jdkUrl = 'https://aka.ms/download-jdk/microsoft-jdk-21.0.12-windows-x64.zip'
  $jdkZip = Get-VerifiedArchive $jdkUrl 'jdk21.zip' (Read-OfficialHash "$jdkUrl.sha256sum.txt")
  $unpack = Join-Path $toolRoot 'jdk21-unpack'
  Expand-Archive -LiteralPath $jdkZip -DestinationPath $unpack -Force
  $source = Get-ChildItem -LiteralPath $unpack -Directory | Where-Object {Test-Path -LiteralPath (Join-Path $_.FullName 'bin/java.exe')} | Select-Object -First 1
  if (!$source) { throw 'JDK archive did not contain java.exe.' }
  if (!$source.FullName.StartsWith($toolRoot,[StringComparison]::OrdinalIgnoreCase) -or !$jdkFolder.StartsWith($toolRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe tool path.' }
  Move-Item -LiteralPath $source.FullName -Destination $jdkFolder
}
$env:JAVA_HOME = $jdkFolder
$env:PATH = (Join-Path $jdkFolder 'bin')+';'+$env:PATH
$gradleFolder = Join-Path $toolRoot 'gradle-8.13'
if (!(Test-Path -LiteralPath (Join-Path $gradleFolder 'bin/gradle.bat'))) {
  $gradleUrl = 'https://services.gradle.org/distributions/gradle-8.13-bin.zip'
  $gradleZip = Get-VerifiedArchive $gradleUrl 'gradle.zip' (Read-OfficialHash "$gradleUrl.sha256")
  Expand-Archive -LiteralPath $gradleZip -DestinationPath $toolRoot -Force
}
$sdk = Join-Path $toolRoot 'sdk'
$manager = Join-Path $sdk 'cmdline-tools/latest/bin/sdkmanager.bat'
if (!(Test-Path -LiteralPath $manager)) {
  if (!$AcceptSdkLicense) { throw 'Read https://developer.android.com/studio/terms and rerun with -AcceptSdkLicense only after agreeing.' }
  $toolsZip = Get-VerifiedArchive 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' 'sdk-tools.zip' '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
  $unpack = Join-Path $toolRoot 'sdk-unpack'
  Expand-Archive -LiteralPath $toolsZip -DestinationPath $unpack -Force
  $source = Join-Path $unpack 'cmdline-tools'
  $destination = Join-Path $sdk 'cmdline-tools/latest'
  New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
  if (!$source.StartsWith($toolRoot,[StringComparison]::OrdinalIgnoreCase) -or !$destination.StartsWith($toolRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe tool path.' }
  Move-Item -LiteralPath $source -Destination $destination
}
$sdkArgs = @("--sdk_root=$sdk")
$proxyText = if ($env:HTTPS_PROXY) {$env:HTTPS_PROXY} else {$env:HTTP_PROXY}
if ($proxyText) {
  $proxy = [uri]$proxyText
  if ($proxy.Scheme -eq 'http' -and !$proxy.UserInfo) { $sdkArgs += @('--proxy=http',"--proxy_host=$($proxy.Host)","--proxy_port=$($proxy.Port)") }
}
if ($AcceptSdkLicense) {
  # Accept only prompts needed by these three packages, not unrelated SDK add-ons.
  1..20 | ForEach-Object {'y'} | & $manager @sdkArgs 'platform-tools' 'platforms;android-36' 'build-tools;35.0.0'
} else { & $manager @sdkArgs 'platform-tools' 'platforms;android-36' 'build-tools;35.0.0' }
if ($LASTEXITCODE -ne 0) { throw 'SDK package installation failed.' }
# Java .properties files require escaped Unicode on Windows.
$sdkProperty = -join ($sdk.Replace('\','/').Replace(':','\:').ToCharArray() | ForEach-Object { if([int]$_ -gt 127){'\u{0:x4}' -f [int]$_}else{[string]$_} })
Set-Content -LiteralPath (Join-Path $androidProject 'local.properties') -Value "sdk.dir=$sdkProperty" -Encoding ascii
Write-Host 'Android tools ready (project-local only).'
