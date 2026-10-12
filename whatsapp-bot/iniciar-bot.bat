@echo off
title Bot WhatsApp - Pucacha y Adita
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta instalar Node.js: https://nodejs.org & pause & exit /b)
if not exist node_modules (echo Instalando por primera vez... & call npm install)
node src\index.js
pause
