# Reads the key without placing it in source files or shell history.
param([switch]$FromClipboard)

function ConvertTo-GroqApiKey {
    param([AllowNull()][string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    $keyText = $Value.Trim().Trim([char[]]@([char]0xFEFF, [char]0x200B, [char]34, [char]39)).Trim()
    $keyText = $keyText -replace '^(?i:Bearer\s+|(?:\$env:)?GROQ_API_KEY\s*=\s*)', ''
    $keyText = $keyText.Trim().Trim([char[]]@([char]34, [char]39)).Trim()
    if ($keyText -cmatch '^gsk_[A-Za-z0-9_-]+$') { return $keyText }
    return $null
}

$listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    Write-Warning "El puerto 8000 ya lo usa el proceso $($listener.OwningProcess). Detén ese servidor antes de iniciar la versión nueva."
    return
}
& (Join-Path $PSScriptRoot 'install_models.ps1')
Set-Location -LiteralPath $PSScriptRoot
$modelPython = Join-Path $PSScriptRoot '.venv-openhands\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $modelPython)) {
    Write-Warning 'Falta .venv-openhands. Instala requirements-openhands.txt en ese entorno.'
    return
}
& $modelPython .\infer_bert.py --check
if ($LASTEXITCODE -ne 0) {
    Write-Warning 'No se pudo cargar el modelo BERT. Instala requirements-openhands.txt y verifica el checkpoint.'
    return
}
$secureGroqKey = $null
if ($FromClipboard) {
    try {
        $taskGroqKeyText = Get-Clipboard -Raw -ErrorAction Stop
    } catch {
        Write-Warning 'No se pudo leer el portapapeles. Copia la clave y vuelve a ejecutar el script con -FromClipboard.'
        return
    }
} else {
    $secureGroqKey = Read-Host 'Groq API key (entrada oculta; si falla el pegado, usa -FromClipboard)' -AsSecureString
    $taskGroqKeyText = [System.Net.NetworkCredential]::new('', $secureGroqKey).Password
}
$taskGroqKey = ConvertTo-GroqApiKey $taskGroqKeyText
if ($secureGroqKey) { $secureGroqKey.Dispose() }
Remove-Variable taskGroqKeyText, secureGroqKey -ErrorAction SilentlyContinue
if (-not $taskGroqKey) {
    Remove-Item Env:GROQ_API_KEY -ErrorAction SilentlyContinue
    Write-Warning 'No se recibió una clave completa. Copia la clave gsk_... de Groq y ejecuta: .\start_with_groq.ps1 -FromClipboard'
    return
}
$env:GROQ_API_KEY = $taskGroqKey
Remove-Variable taskGroqKey
Write-Host 'Clave de Groq cargada sin mostrarla.'
$env:VISENA_ENABLE_MANUAL_TEST = '1'
Set-Location -LiteralPath $PSScriptRoot
& .\.venv\Scripts\python.exe .\check_groq.py
Write-Host 'Cuando el servidor arranque, abre http://127.0.0.1:8000/manual-test/camera.html'
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
