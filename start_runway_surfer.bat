@echo off

start "RunwaySurfer Backend" cmd /k "cd /d C:\Users\cengi\Desktop\T1 Automation\RunwaySurfer\server && npm install && npm run dev"

start "RunwaySurfer Extension" cmd /k "cd /d C:\Users\cengi\Desktop\T1 Automation\RunwaySurfer && npm install && npm run dev"