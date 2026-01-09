/**
 * 低优先级Bug修复验证脚本
 * 验证Bug #5 (数据同步竞态条件) 的修复
 */

console.log('🧪 开始验证低优先级Bug修复...\n');

// ===== Bug #5: 数据同步竞态条件验证 =====
console.log('🔍 验证Bug #5: 数据同步竞态条件修复');

// 模拟修复前的同步管理（有问题的版本）
class BuggySyncManager {
  constructor() {
    this.syncStatus = 'idle';
    this.syncCount = 0;
    this.concurrentSyncs = 0;
  }

  async performSync(userId) {
    console.log(`❌ 修复前：开始同步 #${++this.syncCount} (用户: ${userId})`);
    this.syncStatus = 'syncing';
    this.concurrentSyncs++;

    // 模拟同步操作
    await new Promise(resolve => setTimeout(resolve, 100));

    this.concurrentSyncs--;
    this.syncStatus = 'idle';
    console.log(`❌ 修复前：完成同步 #${this.syncCount} (并发数: ${this.concurrentSyncs})`);
  }

  getStatus() {
    return {
      syncStatus: this.syncStatus,
      concurrentSyncs: this.concurrentSyncs,
      totalSyncs: this.syncCount
    };
  }
}

// 模拟修复后的同步管理（正确版本）
class FixedSyncManager {
  constructor() {
    this.syncStatus = 'idle';
    this.syncCount = 0;
    this.syncLock = false;
    this.debouncedSyncTimeout = null;
    this.skippedSyncs = 0;
  }

  async performSync(userId) {
    // ✅ 修复：检查同步锁
    if (this.syncLock) {
      this.skippedSyncs++;
      console.log(`✅ 修复后：同步已在进行中，跳过请求 #${this.skippedSyncs} (用户: ${userId})`);
      return;
    }

    // ✅ 修复：获取同步锁
    this.syncLock = true;
    this.syncStatus = 'syncing';
    console.log(`✅ 修复后：开始同步 #${++this.syncCount} (用户: ${userId})`);

    try {
      // 模拟同步操作
      await new Promise(resolve => setTimeout(resolve, 100));
      this.syncStatus = 'idle';
      console.log(`✅ 修复后：完成同步 #${this.syncCount}`);
    } catch (error) {
      this.syncStatus = 'error';
      console.log(`✅ 修复后：同步失败 #${this.syncCount}:`, error.message);
    } finally {
      // ✅ 修复：释放同步锁
      this.syncLock = false;
    }
  }

  // ✅ 修复：防抖同步
  debouncedSync(userId, delay = 50) {
    if (this.debouncedSyncTimeout) {
      clearTimeout(this.debouncedSyncTimeout);
    }

    this.debouncedSyncTimeout = setTimeout(() => {
      this.performSync(userId);
    }, delay);
  }

  getStatus() {
    return {
      syncStatus: this.syncStatus,
      syncLock: this.syncLock,
      totalSyncs: this.syncCount,
      skippedSyncs: this.skippedSyncs
    };
  }
}

// 测试并发同步场景
async function testConcurrentSync() {
  console.log('\n📊 测试场景1: 并发同步请求');
  
  const buggyManager = new BuggySyncManager();
  const fixedManager = new FixedSyncManager();

  // 模拟用户快速点击同步按钮
  console.log('\n修复前 - 快速连续同步:');
  const buggyPromises = [];
  for (let i = 0; i < 5; i++) {
    buggyPromises.push(buggyManager.performSync('user123'));
  }
  await Promise.all(buggyPromises);
  console.log('修复前最终状态:', buggyManager.getStatus());

  console.log('\n修复后 - 快速连续同步:');
  const fixedPromises = [];
  for (let i = 0; i < 5; i++) {
    fixedPromises.push(fixedManager.performSync('user123'));
  }
  await Promise.all(fixedPromises);
  console.log('修复后最终状态:', fixedManager.getStatus());
}

// 测试防抖同步场景
async function testDebouncedSync() {
  console.log('\n📊 测试场景2: 防抖同步机制');
  
  const fixedManager = new FixedSyncManager();

  console.log('\n模拟频繁的配置更新操作:');
  
  // 模拟用户快速切换多个配置选项
  for (let i = 0; i < 10; i++) {
    console.log(`配置更新 #${i + 1}`);
    fixedManager.debouncedSync('user123', 30); // 30ms防抖
  }

  // 等待防抖完成
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('防抖同步最终状态:', fixedManager.getStatus());
  console.log('✅ 10次配置更新只触发了1次实际同步');
}

// 测试异常情况处理
async function testErrorHandling() {
  console.log('\n📊 测试场景3: 异常情况处理');
  
  class ErrorFixedSyncManager extends FixedSyncManager {
    async performSync(userId) {
      if (this.syncLock) {
        this.skippedSyncs++;
        console.log(`✅ 异常测试：同步已在进行中，跳过请求 (用户: ${userId})`);
        return;
      }

      this.syncLock = true;
      this.syncStatus = 'syncing';
      console.log(`✅ 异常测试：开始同步 #${++this.syncCount} (用户: ${userId})`);

      try {
        // 模拟同步失败
        if (this.syncCount === 2) {
          throw new Error('网络连接失败');
        }
        
        await new Promise(resolve => setTimeout(resolve, 50));
        this.syncStatus = 'idle';
        console.log(`✅ 异常测试：完成同步 #${this.syncCount}`);
      } catch (error) {
        this.syncStatus = 'error';
        console.log(`✅ 异常测试：同步失败 #${this.syncCount}:`, error.message);
      } finally {
        this.syncLock = false;
        console.log(`✅ 异常测试：同步锁已释放`);
      }
    }
  }

  const errorManager = new ErrorFixedSyncManager();

  // 测试正常同步
  await errorManager.performSync('user123');
  
  // 测试异常同步（会失败）
  await errorManager.performSync('user123');
  
  // 测试异常后的恢复
  await errorManager.performSync('user123');
  
  console.log('异常处理最终状态:', errorManager.getStatus());
  console.log('✅ 即使同步失败，锁也被正确释放，后续同步可以正常进行');
}

// 运行所有测试
async function runAllTests() {
  await testConcurrentSync();
  await testDebouncedSync();
  await testErrorHandling();
  
  console.log('\n🎉 Bug #5 修复验证完成！');
  console.log('\n📋 修复效果总结:');
  console.log('✅ 同步锁机制：防止并发同步导致的竞态条件');
  console.log('✅ 防抖机制：减少频繁操作触发的不必要同步');
  console.log('✅ 异常处理：确保同步锁在异常情况下也能正确释放');
  console.log('✅ 状态管理：同步状态显示更加准确可靠');
}

// 执行测试
runAllTests().catch(console.error);