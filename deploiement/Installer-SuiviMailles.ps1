<#
.SYNOPSIS
  Installe ou met à jour Suivi des mailles sur le serveur IIS local.

.DESCRIPTION
  À lancer depuis le dossier dézippé, dans une console PowerShell « Exécuter en tant qu'administrateur » :
      .\Installer-SuiviMailles.ps1
  Puis ouvrir http://localhost:8082/

  - Copie l'application dans le dossier du site (par défaut C:\inetpub\SuiviMailles).
  - Crée le pool d'applications (Aucun code managé) et le site IIS s'ils n'existent pas.
  - Donne au pool le droit Modifier sur App_Data (fichier de données mailles.json).
  - Mise à jour : relancer le script avec le nouveau zip. App_Data (les données) et appsettings.json
    ne sont jamais écrasés.

.PARAMETER Port
  Port HTTP du site. Par défaut 8082.
.PARAMETER Dossier
  Dossier physique du site. Par défaut C:\inetpub\SuiviMailles.
.PARAMETER NomSite
  Nom du site et du pool d'applications IIS. Par défaut SuiviMailles.
.PARAMETER Administrateur
  Adresse mail du premier administrateur (première installation) : seule adresse autorisée à se connecter
  tant qu'aucun autre utilisateur n'est déclaré.
#>
#Requires -RunAsAdministrator
param(
    [int]$Port = 8082,
    [string]$Dossier = "C:\inetpub\SuiviMailles",
    [string]$NomSite = "SuiviMailles",
    [string]$Administrateur = ""
)

$ErrorActionPreference = "Stop"
$source = $PSScriptRoot

Import-Module WebAdministration

# Prérequis : module ASP.NET Core pour IIS, installé par l'ASP.NET Core 8 Hosting Bundle.
if (-not (Get-WebGlobalModule -Name "AspNetCoreModuleV2" -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "Le module ASP.NET Core pour IIS est absent de ce serveur." -ForegroundColor Red
    Write-Host "Installez l'ASP.NET Core 8 Hosting Bundle (« Hosting Bundle » sous ASP.NET Core Runtime 8.0, Windows) :"
    Write-Host "  https://dotnet.microsoft.com/download/dotnet/8.0"
    Write-Host "puis lancez « iisreset » et relancez ce script."
    exit 1
}

# 1. Copie des fichiers. app_offline.htm arrête proprement l'application pendant la copie (DLL verrouillées sinon).
New-Item -ItemType Directory -Force -Path $Dossier | Out-Null
$horsLigne = Join-Path $Dossier "app_offline.htm"
$miseAJour = Test-Path (Join-Path $Dossier "SuiviMailles.dll")
if ($miseAJour) {
    Set-Content -Path $horsLigne -Value "<p>Mise à jour de Suivi des mailles en cours, réessayez dans une minute.</p>" -Encoding UTF8
    Start-Sleep -Seconds 3
}

robocopy $source $Dossier /E /NFL /NDL /NJH /NJS /NP /R:3 /W:5 /XD App_Data logs /XF Installer-SuiviMailles.ps1 LISEZMOI.txt appsettings.json app_offline.htm | Out-Null
if ($LASTEXITCODE -ge 8) { throw "La copie des fichiers a échoué (robocopy code $LASTEXITCODE)." }
if (-not (Test-Path (Join-Path $Dossier "appsettings.json"))) {
    Copy-Item (Join-Path $source "appsettings.json") $Dossier
}

# 2. Pool d'applications : pas de CLR .NET Framework, l'application ASP.NET Core tourne dans son propre runtime.
$cheminPool = "IIS:\AppPools\$NomSite"
if (-not (Test-Path $cheminPool)) {
    New-WebAppPool -Name $NomSite | Out-Null
    Write-Host "Pool d'applications $NomSite créé."
}
Set-ItemProperty $cheminPool -Name managedRuntimeVersion -Value ""

# 3. Site IIS.
if (-not (Test-Path "IIS:\Sites\$NomSite")) {
    New-Website -Name $NomSite -Port $Port -PhysicalPath $Dossier -ApplicationPool $NomSite | Out-Null
    Write-Host "Site $NomSite créé sur le port $Port."
}

# 4. Droits d'écriture du pool sur le dossier de données.
$donnees = Join-Path $Dossier "App_Data"
New-Item -ItemType Directory -Force -Path $donnees | Out-Null
icacls $donnees /grant "IIS AppPool\$($NomSite):(OI)(CI)M" /Q | Out-Null

# 4 bis. Configuration de l'envoi des codes d'accès (créée une seule fois, jamais écrasée).
$smtp = Join-Path $donnees "smtp.json"
$smtpACompleter = $false
if (-not (Test-Path $smtp)) {
    $config = Get-Content (Join-Path $source "smtp.modele.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Administrateur) { $config.Authentification.AdministrateurInitial = $Administrateur }
    $config | ConvertTo-Json -Depth 5 | Set-Content -Path $smtp -Encoding UTF8
    $smtpACompleter = $true
}

# 5. Redémarrage.
if (Test-Path $horsLigne) { Remove-Item $horsLigne }
Restart-WebAppPool -Name $NomSite -ErrorAction SilentlyContinue
if ((Get-Website -Name $NomSite).State -ne "Started") { Start-Website -Name $NomSite }

$portSite = ((Get-WebBinding -Name $NomSite -Protocol http | Select-Object -First 1).bindingInformation -split ":")[1]
Write-Host ""
Write-Host ($(if ($miseAJour) { "Mise à jour terminée." } else { "Installation terminée." })) -ForegroundColor Green
Write-Host "Ouvrir http://localhost:$portSite/"
Write-Host "Données : $donnees\mailles.json"
if ($smtpACompleter) {
    Write-Host ""
    Write-Host "A FAIRE : renseigner le serveur SMTP dans $smtp" -ForegroundColor Yellow
    Write-Host "  (Serveur, Port, Ssl, Utilisateur, MotDePasse, Expediteur), puis lancer : Restart-WebAppPool $NomSite"
    if (-not $Administrateur) {
        Write-Host "  et l'adresse du premier administrateur (Authentification > AdministrateurInitial)."
    }
}
