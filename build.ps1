# Build the single-file installer.
#
# Produces dist\Figma на русском.exe — a self-contained WinExe with the Russian
# dictionary and the editor translation layer embedded, so the person downloading
# it gets one file, no console, and nothing to unpack.
#
# The compiler is the one that ships with Windows (.NET Framework's csc.exe), so
# building needs nothing installed either. Node is used only to prepare the two
# embedded resources from the sources in src\, and only when building.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$build = Join-Path $Root 'build'
$dist  = Join-Path $Root 'dist'
New-Item -ItemType Directory -Force -Path $build, $dist | Out-Null

Write-Host 'Готовлю встраиваемые файлы…'

$node = (Get-Command node.exe -ErrorAction SilentlyContinue)
if (-not $node) { throw 'Для сборки нужен Node.js (он готовит словари). Пользователям exe он не нужен.' }

# The shell dictionary goes in minified: the archive has a fixed byte budget.
& node.exe -e @"
const fs = require('fs');
const path = require('path');
const dict = JSON.parse(fs.readFileSync('src/i18n/ru.json', 'utf8'));
fs.writeFileSync('build/ru.json', JSON.stringify(dict), 'utf8');
const { buildEditorLayer } = require('./tools/build-editor-layer');
const layer = buildEditorLayer();
fs.writeFileSync('build/editor-layer.js', layer.code, 'utf8');
console.log('  словарь оболочки: ' + Object.keys(dict).length + ' строк');
console.log('  слой редактора:   ' + layer.phraseCount + ' фраз');
"@
if ($LASTEXITCODE -ne 0) { throw 'Не удалось подготовить встраиваемые файлы.' }

$csc = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw 'Не найден компилятор C# (csc.exe) из состава .NET Framework.' }

# csc does not look for WPF on its own. Prefer the reference assemblies; fall
# back to whatever the runtime resolves from the GAC, which always works but ties
# the build to this machine's exact assembly versions.
$wpf = 'PresentationFramework', 'PresentationCore', 'WindowsBase', 'System.Xaml'
$refRoot = "${env:ProgramFiles(x86)}\Reference Assemblies\Microsoft\Framework\.NETFramework"
$refDir = Get-ChildItem $refRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object {
        $dir = $_.FullName
        -not ($wpf | Where-Object { -not (Test-Path (Join-Path $dir "$_.dll")) })
    } | Sort-Object Name -Descending | Select-Object -First 1

$references = @()
foreach ($name in $wpf) {
    if ($refDir) {
        $references += (Join-Path $refDir.FullName "$name.dll")
    } else {
        $loaded = [System.Reflection.Assembly]::LoadWithPartialName($name)
        if (-not $loaded) { throw "Не найдена сборка $name — нужен .NET Framework с WPF." }
        $references += $loaded.Location
    }
}
$references += 'System.Xml.dll', 'System.Core.dll'

$exe = Join-Path $dist 'Figma на русском.exe'
$sources = Get-ChildItem (Join-Path $Root 'src\exe') -Filter *.cs | ForEach-Object { $_.FullName }

Write-Host 'Компилирую…'

$arguments = @(
    '/nologo'
    '/target:winexe'          # WinExe: no console window, ever
    '/optimize+'
    "/out:$exe"
) + ($references | ForEach-Object { "/reference:$_" }) + @(
    "/resource:$build\ru.json,ru.json"
    "/resource:$build\editor-layer.js,editor-layer.js"
) + $sources

$output = & $csc $arguments 2>&1
if ($LASTEXITCODE -ne 0) {
    $output | ForEach-Object { Write-Host $_ }
    throw 'Компиляция не удалась.'
}

$size = [Math]::Round((Get-Item $exe).Length / 1KB)
Write-Host ''
Write-Host "Готово: $exe ($size КБ)"
