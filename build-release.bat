@echo off
echo 🚀 开始构建发布版APK...

REM 检查Java环境
java -version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Java未安装或未在PATH中
    echo 请先安装Java JDK 11或更高版本
    pause
    exit /b 1
)

REM 检查是否在正确目录
if not exist "android\app\build.gradle" (
    echo ❌ 请在项目根目录运行此脚本
    pause
    exit /b 1
)

REM ============================================================
REM 数据环境闸门：确认 dist 是 release 构建（VITE_FITLOG_ENV=prod）
REM ============================================================
REM `npm run build` 打出来的包默认是 dev 环境，装到手机上会读写 state-dev。
if not exist "dist\fitlog-build-env.json" (
    echo [X] 未找到 dist\fitlog-build-env.json
    echo     请先运行: npm run build:release ^&^& npx cap sync android
    pause
    exit /b 1
)
findstr /C:"prod" "dist\fitlog-build-env.json" >nul
if %errorlevel% neq 0 (
    echo [X] dist 不是 release 构建，不能用于发布
    echo     请运行: npm run build:release ^&^& npx cap sync android
    pause
    exit /b 1
)
echo [OK] dist 环境戳: prod

REM 进入android目录
cd android

REM 清理之前的构建
echo 🧹 清理之前的构建...
call gradlew.bat clean
if %errorlevel% neq 0 (
    echo ❌ 清理失败
    cd ..
    pause
    exit /b 1
)

REM 构建发布版APK
echo 🔨 构建发布版APK...
call gradlew.bat assembleRelease
if %errorlevel% neq 0 (
    echo ❌ 构建失败
    cd ..
    pause
    exit /b 1
)

cd ..

REM 检查输出文件
if exist "android\app\build\outputs\apk\release\app-release.apk" (
    echo ✅ APK构建成功!
    echo 📱 APK位置: android\app\build\outputs\apk\release\app-release.apk
    
    REM 显示文件大小
    for %%A in ("android\app\build\outputs\apk\release\app-release.apk") do (
        set /a size=%%~zA/1024/1024
        echo 📏 APK大小: !size! MB
    )
    
    echo.
    echo 🎯 下一步:
    echo   1. 在真实设备上测试APK
    echo   2. 确认所有功能正常工作
    echo   3. 准备发布到应用商店或分发
) else (
    echo ❌ 未找到构建的APK文件
    pause
    exit /b 1
)

pause