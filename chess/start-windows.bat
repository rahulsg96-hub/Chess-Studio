@echo off
rem Builds Chess Studio and opens it at http://localhost:4173
rem Needs Node.js (https://nodejs.org) installed once.
cd /d "%~dp0"
where npm >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist node_modules call npm install
call npm run build || (pause & exit /b 1)
start "" http://localhost:4173/
call npm run preview -- --port 4173
