# Git Bug修复推送自动化脚本
# Git Bug Fix Push Automation Script

param(
    [Parameter(Mandatory=$true)]
    [string]$CommitMessage,
    
    [Parameter(Mandatory=$false)]
    [string]$TagVersion = "",
    
    [Parameter(Mandatory=$false)]
    [switch]$CreateTag = $false,
    
    [Parameter(Mandatory=$false)]
    [switch]$Force = $false
)

Write-Host "🚀 开始Git推送流程..." -ForegroundColor Green
Write-Host "🚀 Starting Git push process..." -ForegroundColor Green

# 1. 检查当前Git状态
Write-Host "`n📋 检查当前状态..." -ForegroundColor Yellow
git status

# 2. 显示修改的文件
Write-Host "`n📁 修改的文件列表:" -ForegroundColor Yellow
$modifiedFiles = git diff --name-only
if ($modifiedFiles) {
    $modifiedFiles | ForEach-Object { Write-Host "  - $_" -ForegroundColor Cyan }
} else {
    Write-Host "  没有修改的文件" -ForegroundColor Gray
}

# 3. 确认是否继续
$confirmation = Read-Host "`n❓ 是否继续推送这些修改? (y/N)"
if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
    Write-Host "❌ 操作已取消" -ForegroundColor Red
    exit 1
}

try {
    # 4. 添加所有修改的文件
    Write-Host "`n📦 添加修改的文件..." -ForegroundColor Yellow
    git add .
    
    # 5. 提交修改
    Write-Host "`n💾 提交修改..." -ForegroundColor Yellow
    git commit -m $CommitMessage
    
    # 6. 推送到远程仓库
    Write-Host "`n🌐 推送到远程仓库..." -ForegroundColor Yellow
    if ($Force) {
        git push --force-with-lease
        Write-Host "⚠️  使用了强制推送" -ForegroundColor Yellow
    } else {
        git push
    }
    
    # 7. 创建标签（如果指定）
    if ($CreateTag -and $TagVersion) {
        Write-Host "`n🏷️  创建版本标签: $TagVersion" -ForegroundColor Yellow
        
        $tagMessage = @"
$CommitMessage

版本: $TagVersion
时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
"@
        
        git tag -a $TagVersion -m $tagMessage
        git push origin $TagVersion
        Write-Host "✅ 标签 $TagVersion 已创建并推送" -ForegroundColor Green
    }
    
    Write-Host "`n🎉 推送完成！" -ForegroundColor Green
    Write-Host "🎉 Push completed successfully!" -ForegroundColor Green
    
    # 显示最新的提交信息
    Write-Host "`n📝 最新提交信息:" -ForegroundColor Yellow
    git log --oneline -1
    
} catch {
    Write-Host "`n❌ 推送过程中出现错误: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 8. 显示远程仓库状态
Write-Host "`n🔗 远程仓库状态:" -ForegroundColor Yellow
git remote -v

Write-Host "`n✨ 所有操作完成！" -ForegroundColor Green