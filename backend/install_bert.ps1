# Installs the official OpenHands WLASL BERT checkpoint in the ignored model directory.
param([string]$Destination = (Join-Path $PSScriptRoot 'models\openhands\wlasl\bert'))
$ErrorActionPreference = 'Stop'
$archiveUrl = 'https://github.com/AI4Bharat/OpenHands/releases/download/checkpoints_v1/wlasl_bert.zip'
$archiveSha256 = '7BCB942D29B2C9F1D3426350ECA0D5B16725E6DF46E370DB24E29B08125C4D09'
$checkpointSha256 = '4C5F0A606B76F32A47B132E50A199BC626DFF38F5108B2CB4007BE077E85E090'
$destination = $Destination
$checkpoint = Join-Path $destination 'epoch=392-step=175670.ckpt'
if ((Test-Path -LiteralPath $checkpoint) -and
    (Get-FileHash -LiteralPath $checkpoint -Algorithm SHA256).Hash -eq $checkpointSha256) {
    Write-Host 'El checkpoint BERT ya está verificado.'
    return
}
$download = [System.IO.Path]::GetTempFileName()
try {
    Invoke-WebRequest -Uri $archiveUrl -OutFile $download
    if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $archiveSha256) {
        throw 'El archivo descargado no coincide con el SHA-256 esperado.'
    }
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Add-Type -AssemblyName System.IO.Compression
    $archive = [System.IO.Compression.ZipFile]::OpenRead($download)
    try {
        foreach ($name in @('epoch=392-step=175670.ckpt', 'config.yaml')) {
            $entry = $archive.GetEntry("wlasl/bert/$name")
            if ($null -eq $entry) { throw "Falta $name en el archivo oficial." }
            $source = $entry.Open()
            $target = [System.IO.File]::Create((Join-Path $destination $name))
            try { $source.CopyTo($target) }
            finally { $target.Dispose(); $source.Dispose() }
        }
    } finally { $archive.Dispose() }
    if ((Get-FileHash -LiteralPath $checkpoint -Algorithm SHA256).Hash -ne $checkpointSha256) {
        throw 'El checkpoint extraído no coincide con el SHA-256 esperado.'
    }
    Write-Host 'Checkpoint temporal OpenHands BERT instalado y verificado.'
} finally {
    Remove-Item -LiteralPath $download -ErrorAction SilentlyContinue
}
