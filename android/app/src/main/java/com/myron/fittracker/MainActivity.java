package com.myron.fittracker;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 本地插件（不在 node_modules 里）要在 super.onCreate 之前注册
        registerPlugin(FitlogFolderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
