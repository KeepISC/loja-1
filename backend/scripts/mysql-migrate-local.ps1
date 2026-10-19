# Windows fallback for environments that refuse Node child-process spawning.
# Uses the installed Prisma engine and the same versioned migrations as migrate deploy.
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$schemaProcess = $null
$migrationStage = 'preflight'
try {
  & node (Join-Path $PSScriptRoot 'mysql-local.mjs') inspect
  if ($LASTEXITCODE -ne 0) { throw 'Local preflight failed.' }
  $migrationStage = 'environment parsing'
  $connectionLine = Get-Content -LiteralPath (Join-Path $taskRoot '.env.mysql.test') | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
  $connectionValue = $connectionLine.Substring('DATABASE_URL='.Length).Trim().Trim('"').Trim("'")
  $target = [System.Uri]$connectionValue
  if ($target.Scheme -ne 'mysql' -or $target.Host -cne 'localhost' -or $target.Port -ne 3306 -or $target.AbsolutePath -cne '/loja1_test' -or $target.Query -or $target.Fragment -or $target.UserInfo.Split(':')[0] -cne 'loja1_test_app') { throw 'Invalid local target.' }
  $migrationStage = 'engine startup'
  $schemaPath = Join-Path $taskRoot 'prisma/mysql/schema.prisma'
  $engineInfo = New-Object System.Diagnostics.ProcessStartInfo
  $engineInfo.FileName = Join-Path $taskRoot 'node_modules/@prisma/engines/schema-engine-windows.exe'
  $engineInfo.Arguments = '--datamodels "' + $schemaPath + '"'
  $engineInfo.WorkingDirectory = $taskRoot
  $engineInfo.UseShellExecute = $false
  $engineInfo.CreateNoWindow = $true
  $engineInfo.RedirectStandardInput = $true
  $engineInfo.RedirectStandardOutput = $true
  $engineInfo.RedirectStandardError = $true
  $engineInfo.EnvironmentVariables['DATABASE_URL'] = $connectionValue
  $schemaProcess = New-Object System.Diagnostics.Process
  $schemaProcess.StartInfo = $engineInfo
  [void]$schemaProcess.Start()
  $migrationStage = 'engine migration'
  $engineErrors = $schemaProcess.StandardError.ReadToEndAsync()
  $rpc = @{ id = 1; jsonrpc = '2.0'; method = 'applyMigrations'; params = @{ migrationsDirectoryPath = (Join-Path $taskRoot 'prisma/mysql/migrations') } } | ConvertTo-Json -Depth 5 -Compress
  $schemaProcess.StandardInput.WriteLine($rpc)
  $schemaProcess.StandardInput.Flush()
  while ($true) {
    $read = $schemaProcess.StandardOutput.ReadLineAsync()
    if (!$read.Wait(30000)) { throw 'Migration engine timed out; inspect migration status before retrying.' }
    $line = $read.Result
    if (!$line) { throw 'Migration engine stopped before completing.' }
    $response = $line | ConvertFrom-Json
    if ($response.method -eq 'print') {
      # Engine diagnostic content can contain credentials; acknowledge without printing it.
      $ack = @{ id = $response.id; jsonrpc = '2.0'; result = @{} } | ConvertTo-Json -Compress
      $schemaProcess.StandardInput.WriteLine($ack)
      $schemaProcess.StandardInput.Flush()
      continue
    }
    if ($response.id -eq 1) {
      if ($response.error) {
        $errorCode = [string]$response.error.data.error_code
        if ($errorCode -match '^P[0-9]{4}$') { Write-Output ('Prisma migration error: ' + $errorCode) }
        Write-Output ('Engine RPC status: ' + [int]$response.error.code)
        throw 'Migration engine reported an error; inspect the local database before retrying.'
      }
      $applied = @($response.result.appliedMigrationNames)
      Write-Output ('Prisma migrations applied: ' + $applied.Count)
      break
    }
  }
} catch {
  Write-Output ('Local MySQL migration failed or incomplete at ' + $migrationStage + '. Connection details suppressed; do not reset the database.')
  exit 1
} finally {
  if ($schemaProcess) {
    if (!$schemaProcess.HasExited) { $schemaProcess.Kill() }
    $schemaProcess.Dispose()
  }
  $connectionValue = $null
}
