Add-Type -AssemblyName System.Device
$watcher = New-Object System.Device.Location.GeoCoordinateWatcher
$watcher.MovementThreshold = 50
$watcher.Start()

$deadline = (Get-Date).AddSeconds(15)
while (
  $watcher.Status -ne 'Ready' -and
  $watcher.Permission -ne 'Denied' -and
  (Get-Date) -lt $deadline
) {
  Start-Sleep -Milliseconds 250
}

$loc = $watcher.Position.Location
$result = [ordered]@{
  ok         = $false
  status     = [string]$watcher.Status
  permission = [string]$watcher.Permission
}

if ($watcher.Permission -eq 'Denied') {
  $result.error = 'Location permission denied in Windows settings'
} elseif ($null -eq $loc -or $loc.IsUnknown) {
  $result.error = 'Windows location is unknown (enable Location in Settings)'
} else {
  $result.ok = $true
  $result.lat = [double]$loc.Latitude
  $result.lon = [double]$loc.Longitude
  $result.accuracy = [double]$loc.HorizontalAccuracy
}

$watcher.Stop()
$result | ConvertTo-Json -Compress
