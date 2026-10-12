@echo off
title Instalar Kyiv FPV
setlocal

set "INSTALADOR="
for %%F in ("%~dp0Kyiv FPV Setup*.exe") do set "INSTALADOR=%%~fF"

echo ==============================================
echo   Instalador do Kyiv FPV - prototipo
echo ==============================================
echo.

if defined INSTALADOR if exist "%INSTALADOR%" goto abrir

echo Nao encontrei o instalador do Kyiv FPV nesta pasta:
echo   %~dp0
echo.
echo Coloque este .bat na mesma pasta do arquivo Kyiv FPV Setup*.exe.
echo Se voce baixou um .zip, extraia tudo antes de executar.
echo.
pause
exit /b 1

:abrir
echo Abrindo o instalador. Siga as telas que vao aparecer.
echo - A instalacao e so para o seu usuario: nao precisa de administrador.
echo - Local padrao: %LOCALAPPDATA%\Programs\Kyiv FPV
echo - Se o Windows mostrar "O Windows protegeu o seu PC", clique em
echo   "Mais informacoes" e depois em "Executar assim mesmo".
echo.

"%INSTALADOR%"

echo.
echo Fim. Se a instalacao foi concluida, o Kyiv FPV aparece no menu Iniciar.
echo Para desinstalar: Configuracoes do Windows ^> Aplicativos.
echo.
pause
endlocal
