@echo off
rem Avvio portable: usa la cartella in cui si trova questo script,
rem cosi' il progetto funziona da qualsiasi percorso (USB, altro PC, ecc.)

start "RunwaySurfer Backend" /d "%~dp0server" cmd /k "npm install && npm run dev"

start "RunwaySurfer Extension" /d "%~dp0." cmd /k "npm install && npm run dev"
