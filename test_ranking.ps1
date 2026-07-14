try {
    $r = Invoke-RestMethod -Uri 'http://localhost:3001/api/status' -Method Get
    Write-Host "Server Status:"
    $r | ConvertTo-Json -Depth 5
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
