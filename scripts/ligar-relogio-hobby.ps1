# Liga o relógio Hobby: imprime os comandos (não grava secrets sozinho).
# Uso: .\scripts\ligar-relogio-hobby.ps1 -AppUrl https://crm-gabrielle.vercel.app
param(
  [Parameter(Mandatory = $true)][string]$AppUrl,
  [string]$Repo = "IanCouto/DeskcommCRM"
)

$AppUrl = $AppUrl.TrimEnd("/")
$Tick = "$AppUrl/api/v1/system/relogio/tick"

Write-Host @"
=== Relógio Hobby ===

1) GitHub Actions (grátis, a cada ~5 min) — o workflow PRECISA estar na main:

   gh variable set RELOGIO_LIGADO -R $Repo -b 1
   gh secret set RELOGIO_APP_URL -R $Repo -b "$AppUrl"
   gh secret set RELOGIO_SECRET -R $Repo
   # (cole o INTERNAL_SECRET da Vercel quando pedir)

   Depois: Actions → relogio → Run workflow

2) cron-job.org (grátis, a cada 1 min) — cole isto no painel:

   URL:    $Tick
   Method: POST
   Header: Authorization = Bearer <INTERNAL_SECRET>

3) Teste agora:

   curl -fsS -X POST -H "Authorization: Bearer `$INTERNAL_SECRET" "$Tick"

Runbook: docs/runbooks/vercel-hobby-relogio.md
"@
