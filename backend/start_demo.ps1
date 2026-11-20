# Local DRINK practice without a Groq key.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    Write-Warning "El puerto 8000 ya lo usa el proceso $($listener.OwningProcess). Detén ese servidor antes de iniciar la versión nueva."
    return
}
& .\install_models.ps1
$modelPython = Join-Path $PSScriptRoot '.venv-openhands\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $modelPython)) {
    throw 'Falta .venv-openhands. Instala requirements-openhands.txt en ese entorno.'
}
& $modelPython .\infer_bert.py --check
if ($LASTEXITCODE -ne 0) { throw 'No se pudo cargar el modelo BERT.' }
$env:VISENA_ENABLE_MANUAL_TEST = '1'
Write-Host 'Abre http://127.0.0.1:8000/manual-test/camera.html cuando arranque el servidor.'
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
