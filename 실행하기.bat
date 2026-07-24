@echo off
REM ================================================
REM  루메인 헤어 - 로컬 실행 (카메라 사용 가능)
REM  더블클릭하면 localhost 서버가 켜지고 브라우저가 열립니다.
REM ================================================
cd /d "%~dp0"
echo.
echo   루메인 헤어를 실행합니다...
echo   창을 닫으면 서버가 종료됩니다.
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8777
  py -m http.server 8777
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8777
  python -m http.server 8777
  goto :eof
)

where node >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8777
  npx --yes http-server -p 8777
  goto :eof
)

echo   [안내] Python 또는 Node가 필요합니다.
echo   설치 없이 보려면 index.html 을 그냥 더블클릭하세요.
echo   (단, 그 경우 카메라는 안 켜지고 '사진 업로드'만 됩니다)
pause
