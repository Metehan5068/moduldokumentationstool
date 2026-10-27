@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo Installiere Abhaengigkeiten ...
  call npm install || goto :fehler
)

echo Baue Anwendung ...
call npm run build || goto :fehler

rem Browser kurz verzoegert oeffnen, damit der Server schon lauscht
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:3000"

call npm start
goto :eof

:fehler
echo.
echo Start fehlgeschlagen. Details siehe oben.
pause
exit /b 1
