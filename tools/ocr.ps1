# Windows' own OCR over an image: prints one line per recognised text line as "x,y,w,h<TAB>text" (pixels).
# Used by client_drive.py to find a world tile by its name.
param([Parameter(Mandatory = $true)][string]$Path)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path $Path).Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
foreach ($line in $result.Lines) {
    $xs = $line.Words | ForEach-Object { $_.BoundingRect.X }; $ys = $line.Words | ForEach-Object { $_.BoundingRect.Y }
    $x2 = $line.Words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width }; $y2 = $line.Words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height }
    $x = ($xs | Measure-Object -Minimum).Minimum; $y = ($ys | Measure-Object -Minimum).Minimum
    "{0},{1},{2},{3}`t{4}" -f [int]$x, [int]$y, [int](($x2 | Measure-Object -Maximum).Maximum - $x), [int](($y2 | Measure-Object -Maximum).Maximum - $y), $line.Text
}
