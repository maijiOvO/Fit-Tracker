# 在调用方的输出管道之外先把 Gradle 守护进程拉起来。由 build-apk / deploy-android / live-android 点引用。
#
# 为什么：守护进程若由本次构建新起，会继承调用方 stdout 管道的写端，构建完它常驻（默认空闲 3 小时），
# 管道永远不关。凡是「把输出接进管道再读到底」的调用方 —— `npm run apk:personal *> log`、
# Claude 的 Bash / PowerShell 工具、CI —— 都会在打印「完成。」之后无限挂住。
# 守护进程已经在跑时构建只是复用它，不挂。所以这里先在独立进程里起一个，后面的构建去复用。
#
# 注意 `Start-Process -Wait` 在 PowerShell 5.1 会连子孙进程一起等（守护进程正是子孙），
# 必须 -PassThru + WaitForExit()，只等 gradlew 本身。
# 调用前要已设好 JAVA_HOME（守护进程按 JDK 和 jvmargs 匹配，不一致构建时会另起一个，又会挂）。
function Start-GradleDaemonDetached([string]$AndroidDir) {
    $p = Start-Process -FilePath (Join-Path $AndroidDir 'gradlew.bat') -ArgumentList 'help', '-q' `
        -WorkingDirectory $AndroidDir -WindowStyle Hidden -PassThru
    $p.WaitForExit()
}
