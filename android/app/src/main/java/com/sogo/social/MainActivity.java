package com.sogo.social;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaSaverPlugin.class);
        registerPlugin(InstallReferrerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
