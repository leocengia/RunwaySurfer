@echo off
rem Avvio portable: usa la cartella in cui si trova questo script,
rem cosi' il progetto funziona da qualsiasi percorso (USB, altro PC, ecc.)
rem
rem SOLO PER SVILUPPO: lancia "npm run dev" in due finestre che muoiono al
rem logoff. La procedura di produzione e' un'altra (vedi docs/RUNBOOK-BACKEND.md).
rem
rem La configurazione del backend si mette in server\.env (copia di
rem server\.env.example): dalla prima esecuzione viene letta davvero. Serve
rem almeno ADMIN_BOOTSTRAP_PASSWORD, altrimenti su un database vuoto la dashboard
rem non e' accessibile e l'unico segnale e' una riga di avviso [auth] nei log.

if not exist "%~dp0server\.env" (
  echo.
  echo   ATTENZIONE: server\.env non esiste.
  echo   Copialo da server\.env.example e imposta almeno ADMIN_BOOTSTRAP_PASSWORD,
  echo   altrimenti non potrai entrare nella dashboard.
  echo.
)

start "RunwaySurfer Backend" /d "%~dp0server" cmd /k "npm install && npm run dev"

start "RunwaySurfer Extension" /d "%~dp0." cmd /k "npm install && npm run dev"
