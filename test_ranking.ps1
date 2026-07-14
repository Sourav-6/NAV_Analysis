$body = '{"categories":["flexi cap"],"plan":"direct","analysisPeriod":"3Y","rollingWindow":"1Y"}'
$result = Invoke-RestMethod -Uri 'http://localhost:3001/api/ranking/calculate' -Method Post -Body $body -ContentType 'application/json'
Write-Host "Result count: $($result.Count)"
Write-Host ""

# Also check a known flexi cap scheme's NAV count
$navCheck = Invoke-RestMethod -Uri 'http://localhost:3001/api/nav/122639/summary' -Method Get
Write-Host "Parag Parikh Flexi Cap NAV data points: $($navCheck.totalDataPoints)"
Write-Host "Latest: $($navCheck.latestNav.date)"
Write-Host "Oldest: $($navCheck.oldestNav.date)"
