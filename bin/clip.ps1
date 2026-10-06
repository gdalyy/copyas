# Windows: put CF_HTML and Unicode text on the clipboard.
# Run as: powershell -NoProfile -STA -ExecutionPolicy Bypass -File clip.ps1 -Path <json file>
# The file holds {"html": ..., "text": ...} as UTF-8; a file avoids console encoding issues.
param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = 'Stop'
$payload = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
$html = [string]$payload.html
$text = [string]$payload.text

# CF_HTML: a header with byte offsets, then the document with fragment markers
$pre = '<html><body><!--StartFragment-->'
$post = '<!--EndFragment--></body></html>'
$header = "Version:0.9`r`nStartHTML:{0:D10}`r`nEndHTML:{1:D10}`r`nStartFragment:{2:D10}`r`nEndFragment:{3:D10}`r`n"
$utf8 = [System.Text.Encoding]::UTF8
$startHtml = ($header -f 0, 0, 0, 0).Length
$startFragment = $startHtml + $utf8.GetByteCount($pre)
$endFragment = $startFragment + $utf8.GetByteCount($html)
$endHtml = $endFragment + $utf8.GetByteCount($post)
$cfHtml = ($header -f $startHtml, $endHtml, $startFragment, $endFragment) + $pre + $html + $post

Add-Type -AssemblyName System.Windows.Forms
$object = New-Object System.Windows.Forms.DataObject
$object.SetData([System.Windows.Forms.DataFormats]::Html, $cfHtml)
$object.SetText($text, [System.Windows.Forms.TextDataFormat]::UnicodeText)
[System.Windows.Forms.Clipboard]::SetDataObject($object, $true)
Write-Output 'ready'
