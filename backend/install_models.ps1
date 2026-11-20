# Downloads the exact model assets used by the ASL camera workflow.
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'install_bert.ps1')

$holisticPath = Join-Path $PSScriptRoot 'models\holistic_landmarker.task'
$holisticHash = 'E2DAB61191E2DCD0A15F943D8E3ED1DCE13C82DFA597B9DD39F562975A50C3F8'
if (-not ((Test-Path -LiteralPath $holisticPath) -and
    (Get-FileHash -LiteralPath $holisticPath -Algorithm SHA256).Hash -eq $holisticHash)) {
    $download = [System.IO.Path]::GetTempFileName()
    try {
        Invoke-WebRequest -Uri 'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task' -OutFile $download
        if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $holisticHash) {
            throw 'El modelo MediaPipe descargado no coincide con el SHA-256 esperado.'
        }
        Copy-Item -LiteralPath $download -Destination $holisticPath -Force
    } finally { Remove-Item -LiteralPath $download -ErrorAction SilentlyContinue }
}

$splitsDir = Join-Path $PSScriptRoot 'models\openhands\splits'
$labelsPath = Join-Path $splitsDir 'asl2000.json'
$labelsHash = 'C2BABF1A5A9A2EED12FC4D206F6C92185220691CD57272AEFD6C1CC598FAF2AC'
if (-not ((Test-Path -LiteralPath $labelsPath) -and
    (Get-FileHash -LiteralPath $labelsPath -Algorithm SHA256).Hash -eq $labelsHash)) {
    $download = [System.IO.Path]::GetTempFileName()
    try {
        Invoke-WebRequest -Uri 'https://github.com/AI4Bharat/OpenHands/releases/download/checkpoints_v1/wlasl_metadata.zip' -OutFile $download
        if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne
            '4828AE6B9A630A0169FEABC6AB14668E40EA95D477B842B37175E4BD8A16932A') {
            throw 'La metadata WLASL descargada no coincide con el SHA-256 esperado.'
        }
        New-Item -ItemType Directory -Force -Path $splitsDir | Out-Null
        Add-Type -AssemblyName System.IO.Compression
        $archive = [System.IO.Compression.ZipFile]::OpenRead($download)
        try {
            $entry = $archive.GetEntry('splits/asl2000.json')
            if ($null -eq $entry) { throw 'Faltan las etiquetas asl2000.json.' }
            $source = $entry.Open()
            $target = [System.IO.File]::Create($labelsPath)
            try { $source.CopyTo($target) }
            finally { $target.Dispose(); $source.Dispose() }
        } finally { $archive.Dispose() }
        if ((Get-FileHash -LiteralPath $labelsPath -Algorithm SHA256).Hash -ne $labelsHash) {
            throw 'Las etiquetas extraídas no coinciden con el SHA-256 esperado.'
        }
    } finally { Remove-Item -LiteralPath $download -ErrorAction SilentlyContinue }
}
Write-Host 'Modelos y etiquetas de cámara verificados.'
