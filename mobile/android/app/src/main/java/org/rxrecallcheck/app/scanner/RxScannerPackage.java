package org.rxrecallcheck.app.scanner;

import com.facebook.react.BaseReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.module.model.ReactModuleInfoProvider;

import java.util.HashMap;
import java.util.Map;

/** Registers the on-device label scanner (Android). */
public final class RxScannerPackage extends BaseReactPackage {
    @Override
    public NativeModule getModule(String name, ReactApplicationContext ctx) {
        return RxScannerModule.NAME.equals(name) ? new RxScannerModule(ctx) : null;
    }

    @Override
    public ReactModuleInfoProvider getReactModuleInfoProvider() {
        return () -> {
            Map<String, ReactModuleInfo> m = new HashMap<>();
            m.put(RxScannerModule.NAME, new ReactModuleInfo(RxScannerModule.NAME, RxScannerModule.class.getName(), false, false, false, false));
            return m;
        };
    }
}
