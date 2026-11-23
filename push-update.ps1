param(
  [string]$Message = "chore: update EslabQol SRS app"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

npm run build
git add -A
$status = git status --porcelain
if ($status) {
  git commit -m $Message
  git push origin main
  Write-Host "Successfully pushed update to GitHub (Vercel will auto-deploy main)!"
} else {
  Write-Host "No changes to commit."
}
