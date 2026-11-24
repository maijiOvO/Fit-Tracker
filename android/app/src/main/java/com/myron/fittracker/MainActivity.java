package com.myron.fittracker;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.webkit.WebViewRenderProcess;

import androidx.lifecycle.Lifecycle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    /**
     * 锁屏回来整屏发灰的看门狗（上架审查 C93）。
     *
     * 现象：练到一半锁屏，解锁后整屏灰、点不动，有时十来秒自己恢复，有时要清后台。深色模式下灰的正是原生窗口的底色，
     * 也就是网页那层没在画（小米会在后台用 cgroup 冻结主进程和渲染进程，解冻后渲染进程没及时出帧）。根因没在真机上取到证。
     * 做法：回前台后第一次拿到焦点时向 WebView 要一帧（postVisualStateCallback），6 秒没回话就结束渲染进程，
     * onRenderProcessGone 里重建 Activity —— 页面冷加载，进行中的训练从本机库接回（services/workbenchPersist）。
     * 每次解锁都在 logcat 留一行（tag FitlogWebView）：「出帧 NNms」或「6 秒没出帧」，下次灰屏有据可查。
     * 防误救：只在回前台后第一次拿到焦点时上弦（冷启动首屏、下拉通知栏不算；不用 onResume，它可能在锁屏界面后面就被调到）；
     * 60 秒内只救一次 / 只重建一次，防「崩溃 → 重建」死循环。
     */
    private static final String TAG = "FitlogWebView";
    private static final long FRAME_TIMEOUT_MS = 6000;
    private static final long COOLDOWN_MS = 60_000;
    /** 静态的：recreate 之后也记得 */
    private static long lastRescueAt = -COOLDOWN_MS;
    private static long lastRecreateAt = -COOLDOWN_MS;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean wasPaused = false;
    private boolean recreatePending = false;
    private long armedAt = 0;
    private Runnable watchdog;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 本地插件（不在 node_modules 里）要在 super.onCreate 之前注册
        registerPlugin(FitlogFolderPlugin.class);
        super.onCreate(savedInstanceState);
        // 没有可用的 WebView 时 BridgeActivity 换成提示布局提前返回，bridge 为空
        if (bridge == null) return;
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.w(TAG, "render process gone, didCrash=" + detail.didCrash());
                long now = SystemClock.elapsedRealtime();
                // 60 秒内已经因此重建过：交还系统默认处理（杀掉整个 App，下次冷启动），不再循环
                if (now - lastRecreateAt < COOLDOWN_MS) return false;
                lastRecreateAt = now;
                if (getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) recreate();
                else recreatePending = true;
                return true;
            }
        });
    }

    /**
     * 清单是 singleTop：先在安装器里点「打开」（实例落在安装器的任务里）、再点桌面图标，系统会在 App 的任务里再起一个
     * MainActivity —— 两个 WebView 同时写 IndexedDB。不是任务根、又是桌面图标那种 MAIN + LAUNCHER 启动的，直接结束，不建 Bridge。
     * BridgeActivity 的各个生命周期方法都判了 bridge 为空，跳过 load 是安全的。
     */
    @Override
    protected void load() {
        Intent intent = getIntent();
        if (!isTaskRoot() && intent != null && Intent.ACTION_MAIN.equals(intent.getAction()) && intent.hasCategory(Intent.CATEGORY_LAUNCHER)) {
            finish();
            return;
        }
        super.load();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (recreatePending) {
            recreatePending = false;
            recreate();
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        wasPaused = true;
        disarm();
    }

    @Override
    public void onStop() {
        super.onStop();
        disarm();
    }

    @Override
    public void onDestroy() {
        disarm();
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus) {
            disarm();
            return;
        }
        if (!wasPaused) return;
        wasPaused = false;
        arm();
    }

    private void arm() {
        if (bridge == null) return;
        final WebView wv = bridge.getWebView();
        if (wv == null) return;
        disarm();
        final long id = SystemClock.uptimeMillis();
        armedAt = id;
        wv.postVisualStateCallback(id, new WebView.VisualStateCallback() {
            @Override
            public void onComplete(long requestId) {
                if (requestId != armedAt) return;
                Log.i(TAG, "frame after resume: " + (SystemClock.uptimeMillis() - requestId) + "ms");
                disarm();
            }
        });
        watchdog = () -> {
            watchdog = null;
            if (!hasWindowFocus()) return;
            Log.w(TAG, "no frame " + FRAME_TIMEOUT_MS + "ms after resume");
            rescue(wv);
        };
        handler.postDelayed(watchdog, FRAME_TIMEOUT_MS);
    }

    private void disarm() {
        if (watchdog != null) handler.removeCallbacks(watchdog);
        watchdog = null;
        armedAt = 0;
    }

    /** 渲染进程冻住或卡死时，reload / 新建 WebView 用的还是同一个进程，没用：只能结束它，走 onRenderProcessGone 重建 */
    private void rescue(WebView wv) {
        long now = SystemClock.elapsedRealtime();
        if (now - lastRescueAt < COOLDOWN_MS) {
            Log.w(TAG, "rescued within " + COOLDOWN_MS + "ms, log only");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            WebViewRenderProcess p = wv.getWebViewRenderProcess();
            if (p != null) {
                lastRescueAt = now;
                Log.w(TAG, "terminate render process");
                p.terminate();
                return;
            }
        }
        Log.w(TAG, "no render process handle (API " + Build.VERSION.SDK_INT + "), log only");
    }
}
