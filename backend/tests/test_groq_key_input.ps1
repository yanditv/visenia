# Tests only the pure input normalizer; never reads the real clipboard or starts Uvicorn.
$tokens = $null
$parseErrors = $null
$scriptPath = Join-Path $PSScriptRoot '..\start_with_groq.ps1'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'start_with_groq.ps1 has syntax errors.' }
$normalizer = $ast.Find({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'ConvertTo-GroqApiKey'
}, $true)
. ([scriptblock]::Create($normalizer.Extent.Text))

$fakeKey = 'gsk_' + 'syntheticTestValue123'
$cases = @(
    @{ Input = $fakeKey; Expected = $fakeKey },
    @{ Input = "  $fakeKey`r`n"; Expected = $fakeKey },
    @{ Input = ('"' + $fakeKey + '"'); Expected = $fakeKey },
    @{ Input = "Bearer $fakeKey"; Expected = $fakeKey },
    @{ Input = ('GROQ_API_KEY="' + $fakeKey + '"'); Expected = $fakeKey },
    @{ Input = ('$env:GROQ_API_KEY = ' + "'" + $fakeKey + "'"); Expected = $fakeKey },
    @{ Input = ([string][char]0x16); Expected = $null },
    @{ Input = '*'; Expected = $null },
    @{ Input = ''; Expected = $null }
)
foreach ($case in $cases) {
    $actual = ConvertTo-GroqApiKey $case.Input
    if ($actual -cne $case.Expected) { throw 'Groq key input normalization failed.' }
}
Write-Host "$($cases.Count) Groq input cases passed."
