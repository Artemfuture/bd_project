# Локальная демонстрация без своей базы: отдельный PostgreSQL в папке .demo (порт 5544),
# схема deanery + демо-данные, затем приложение на http://127.0.0.1:8765
#
#   .\scripts\demo.ps1          # запустить (первый раз ~30 секунд)
#   .\scripts\demo.ps1 stop     # остановить временный PostgreSQL
#
# Рабочая база deanery на сервере PostgreSQL (порт 5432) не затрагивается.
param([ValidateSet('start', 'stop')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$demo = Join-Path $root '.demo'
$data = Join-Path $demo 'data'
$port = 5544

$bin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
    Sort-Object { try { [int]$_.Name } catch { 0 } } -Descending |
    ForEach-Object { Join-Path $_.FullName 'bin' } |
    Where-Object { Test-Path (Join-Path $_ 'pg_ctl.exe') } | Select-Object -First 1
if (-not $bin) { throw 'Не найден PostgreSQL в C:\Program Files\PostgreSQL. Установите его или запустите приложение по README.' }

# Процессы PostgreSQL запускаем с выводом в файл, чтобы консоль не ждала их завершения
function Run-Quiet($exe, $argList) {
    $p = Start-Process -FilePath (Join-Path $bin $exe) -ArgumentList $argList -Wait -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $demo "$exe.out.log") -RedirectStandardError (Join-Path $demo "$exe.err.log")
    if ($p.ExitCode -ne 0) { throw "$exe завершился с кодом $($p.ExitCode), см. $demo\$exe.err.log" }
}

New-Item -ItemType Directory -Force $demo | Out-Null

if ($Action -eq 'stop') {
    if (Test-Path $data) { Run-Quiet 'pg_ctl.exe' @('-D', "`"$data`"", '-m', 'fast', 'stop') }
    'Временный PostgreSQL остановлен.'
    return
}

if (-not (Test-Path (Join-Path $data 'PG_VERSION'))) {
    'Создаю временную базу (один раз)...'
    Run-Quiet 'initdb.exe' @('-D', "`"$data`"", '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C')
}
& (Join-Path $bin 'pg_ctl.exe') -D $data status *> $null
if ($LASTEXITCODE -ne 0) {
    'Запускаю PostgreSQL на порту 5544...'
    # без -Wait: сервер остаётся работать, и Start-Process -Wait ждал бы его вечно
    Start-Process -FilePath (Join-Path $bin 'pg_ctl.exe') -NoNewWindow `
        -ArgumentList @('-D', "`"$data`"", '-o', "`"-p $port`"", '-l', "`"$(Join-Path $demo 'pg.log')`"", 'start') `
        -RedirectStandardOutput (Join-Path $demo 'pg_start.out.log') -RedirectStandardError (Join-Path $demo 'pg_start.err.log') | Out-Null
    $ready = $false
    for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
        Start-Sleep -Milliseconds 500
        & (Join-Path $bin 'pg_isready.exe') -h 127.0.0.1 -p $port *> $null
        $ready = ($LASTEXITCODE -eq 0)
    }
    if (-not $ready) { throw "PostgreSQL не запустился за 30 секунд, см. $demo\pg.log" }
}

$env:PGCLIENTENCODING = 'UTF8'
$psql = Join-Path $bin 'psql.exe'
$exists = & $psql -h 127.0.0.1 -p $port -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'deanery'"
if (-not $exists) {
    'Создаю базу deanery и загружаю схему...'
    & $psql -h 127.0.0.1 -p $port -U postgres -d postgres -q -c "CREATE DATABASE deanery TEMPLATE template0 ENCODING 'UTF8'"
    & $psql -h 127.0.0.1 -p $port -U postgres -d deanery -v ON_ERROR_STOP=1 -q -f (Join-Path $root 'db\deanery.sql') *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось загрузить db\deanery.sql' }
}

$env:DATABASE_URL = "postgresql://postgres@127.0.0.1:$port/deanery"
$env:SESSION_SECRET = 'demo-only-secret-change-me'
$env:PYTHONUTF8 = '1'
$py = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { throw 'Нет .venv. Создайте окружение и поставьте зависимости (см. README).' }
Set-Location $root
& $py -m scripts.seed_demo
''
'Приложение: http://127.0.0.1:8765   (остановить: Ctrl+C; временный PostgreSQL: .\scripts\demo.ps1 stop)'
& $py run.py
