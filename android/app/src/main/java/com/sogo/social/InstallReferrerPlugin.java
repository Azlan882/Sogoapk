package com.sogo.social;

import android.content.Context;
import android.os.RemoteException;
import android.util.Log;

import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native Capacitor Plugin for Google Play Install Referrer API.
 * Safely queries the official InstallReferrerClient on first app launch
 * after a Google Play installation.
 */
@CapacitorPlugin(name = "InstallReferrer")
public class InstallReferrerPlugin extends Plugin {
    private static final String TAG = "InstallReferrerPlugin";

    @PluginMethod
    public void getInstallReferrer(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context is null");
            return;
        }

        try {
            final InstallReferrerClient referrerClient = InstallReferrerClient.newBuilder(context).build();
            referrerClient.startConnection(new InstallReferrerStateListener() {
                @Override
                public void onInstallReferrerSetupFinished(int responseCode) {
                    JSObject ret = new JSObject();
                    try {
                        switch (responseCode) {
                            case InstallReferrerClient.InstallReferrerResponse.OK:
                                ReferrerDetails response = referrerClient.getInstallReferrer();
                                String installReferrer = response.getInstallReferrer();
                                long referrerClickTimestampSeconds = response.getReferrerClickTimestampSeconds();
                                long installBeginTimestampSeconds = response.getInstallBeginTimestampSeconds();
                                boolean googlePlayInstantParam = response.getGooglePlayInstantParam();

                                Log.d(TAG, "Install referrer retrieved successfully: " + installReferrer);

                                ret.put("success", true);
                                ret.put("installReferrer", installReferrer != null ? installReferrer : "");
                                ret.put("referrerClickTimestamp", referrerClickTimestampSeconds);
                                ret.put("installBeginTimestamp", installBeginTimestampSeconds);
                                ret.put("googlePlayInstant", googlePlayInstantParam);
                                call.resolve(ret);
                                break;

                            case InstallReferrerClient.InstallReferrerResponse.FEATURE_NOT_SUPPORTED:
                                Log.i(TAG, "Install referrer feature not supported on this device/version");
                                ret.put("success", false);
                                ret.put("error", "FEATURE_NOT_SUPPORTED");
                                call.resolve(ret);
                                break;

                            case InstallReferrerClient.InstallReferrerResponse.SERVICE_UNAVAILABLE:
                                Log.i(TAG, "Play Store install referrer service unavailable");
                                ret.put("success", false);
                                ret.put("error", "SERVICE_UNAVAILABLE");
                                call.resolve(ret);
                                break;

                            case InstallReferrerClient.InstallReferrerResponse.DEVELOPER_ERROR:
                                Log.w(TAG, "Install referrer developer error");
                                ret.put("success", false);
                                ret.put("error", "DEVELOPER_ERROR");
                                call.resolve(ret);
                                break;

                            default:
                                Log.w(TAG, "Install referrer unknown response code: " + responseCode);
                                ret.put("success", false);
                                ret.put("error", "UNKNOWN_RESPONSE_" + responseCode);
                                call.resolve(ret);
                                break;
                        }
                    } catch (RemoteException e) {
                        Log.e(TAG, "RemoteException reading install referrer", e);
                        ret.put("success", false);
                        ret.put("error", "REMOTE_EXCEPTION: " + e.getMessage());
                        call.resolve(ret);
                    } catch (Exception e) {
                        Log.e(TAG, "Unexpected error retrieving install referrer details", e);
                        ret.put("success", false);
                        ret.put("error", e.getMessage());
                        call.resolve(ret);
                    } finally {
                        try {
                            referrerClient.endConnection();
                        } catch (Exception ignored) {
                        }
                    }
                }

                @Override
                public void onInstallReferrerServiceDisconnected() {
                    Log.i(TAG, "Install referrer service disconnected");
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error initiating InstallReferrerClient", e);
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }
}
