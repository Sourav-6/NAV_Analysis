Write-Host "Triggering update request..."
try {
    $res = Invoke-RestMethod -Uri 'http://localhost:3001/api/data/update' -Method Post -ContentType 'application/json'
    Write-Host "Response:"
    $res | ConvertTo-Json
    
    Write-Host "Waiting 5 seconds to check logs..."
    Start-Sleep -Seconds 5
    
    $status = Invoke-RestMethod -Uri 'http://localhost:3001/api/status' -Method Get
    Write-Host "Current status:"
    $status | ConvertTo-Json -Depth 5
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
