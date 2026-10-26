package com.sogo.social;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(
    name = "MediaSaver",
    permissions = {
        @Permission(
            alias = "storage",
            strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }
        )
    }
)
public class MediaSaverPlugin extends Plugin {

    @PluginMethod
    public void saveImageToGallery(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // Android 9 and below requires WRITE_EXTERNAL_STORAGE
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissionForAlias("storage", call, "storageCallback");
                return;
            }
        }
        executeSave(call);
    }

    @PluginMethod
    public void saveVideoToGallery(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // Android 9 and below requires WRITE_EXTERNAL_STORAGE
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissionForAlias("storage", call, "videoStorageCallback");
                return;
            }
        }
        executeSaveVideo(call);
    }

    @PermissionCallback
    private void storageCallback(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED) {
            executeSave(call);
        } else {
            call.reject("Storage permission denied", "PERMISSION_DENIED");
        }
    }

    @PermissionCallback
    private void videoStorageCallback(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED) {
            executeSaveVideo(call);
        } else {
            call.reject("Storage permission denied. Please allow storage access to save Reels.", "PERMISSION_DENIED");
        }
    }

    private HttpURLConnection openVideoConnection(String urlString) throws Exception {
        String currentUrl = urlString;
        for (int redirectCount = 0; redirectCount < 5; redirectCount++) {
            URL u = new URL(currentUrl);
            HttpURLConnection conn = (HttpURLConnection) u.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(60000);
            conn.setRequestProperty("User-Agent", "SogoSocial-Android/1.0");
            conn.setRequestProperty("Accept", "video/mp4,video/*;q=0.9,*/*;q=0.8");
            conn.connect();

            int status = conn.getResponseCode();
            if (status == HttpURLConnection.HTTP_MOVED_TEMP
                    || status == HttpURLConnection.HTTP_MOVED_PERM
                    || status == HttpURLConnection.HTTP_SEE_OTHER
                    || status == 307
                    || status == 308) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location != null && !location.trim().isEmpty()) {
                    currentUrl = new URL(u, location).toString();
                    continue;
                }
            }
            return conn;
        }
        throw new Exception("Too many redirects while downloading video");
    }

    private void emitVideoProgress(String videoId, long loadedBytes, long totalBytes, int percent) {
        try {
            JSObject progress = new JSObject();
            if (videoId != null) {
                progress.put("videoId", videoId);
            }
            progress.put("loadedBytes", loadedBytes);
            progress.put("totalBytes", totalBytes);
            progress.put("percent", percent);
            notifyListeners("downloadProgress", progress);
        } catch (Exception ignored) {}
    }

    private void executeSaveVideo(PluginCall call) {
        String base64Data = call.getString("base64");
        String videoUrl = call.getString("url");
        String fallbackUrl = call.getString("fallbackUrl");
        String filename = call.getString("filename");
        String mimeType = call.getString("mimeType", "video/mp4");
        String videoId = call.getString("videoId", "");

        if (filename == null || filename.trim().isEmpty()) {
            filename = "sogosocial-reel-" + System.currentTimeMillis() + ".mp4";
        }
        filename = filename.replaceAll("[^a-zA-Z0-9._\\-]", "_");
        if (!filename.toLowerCase().endsWith(".mp4")
                && !filename.toLowerCase().endsWith(".webm")
                && !filename.toLowerCase().endsWith(".mov")) {
            filename = filename + ".mp4";
        }

        if ((base64Data == null || base64Data.trim().isEmpty()) &&
            (videoUrl == null || videoUrl.trim().isEmpty())) {
            call.reject("Neither video URL nor base64 data provided to save Reel", "INVALID_INPUT");
            return;
        }

        final String finalFilename = filename;
        final String finalMimeType = (mimeType != null && !mimeType.trim().isEmpty()) ? mimeType : "video/mp4";
        final String finalBase64 = base64Data;
        final String finalUrl = videoUrl;
        final String finalFallbackUrl = fallbackUrl;
        final String finalVideoId = videoId;

        bridge.execute(() -> {
            Uri videoUri = null;
            ContentResolver resolver = getContext().getContentResolver();
            HttpURLConnection connection = null;
            try {
                InputStream inputStream = null;
                long expectedTotalBytes = -1;

                if (finalBase64 != null && !finalBase64.trim().isEmpty()) {
                    String cleanBase64 = finalBase64;
                    if (cleanBase64.contains(",")) {
                        cleanBase64 = cleanBase64.substring(cleanBase64.indexOf(",") + 1);
                    }
                    byte[] videoBytes = Base64.decode(cleanBase64, Base64.DEFAULT);
                    if (videoBytes == null || videoBytes.length == 0) {
                        call.reject("Decoded video byte buffer is empty", "EMPTY_DATA");
                        return;
                    }
                    expectedTotalBytes = videoBytes.length;
                    inputStream = new ByteArrayInputStream(videoBytes);
                } else {
                    try {
                        connection = openVideoConnection(finalUrl);
                        int responseCode = connection.getResponseCode();
                        if (responseCode < 200 || responseCode >= 300) {
                            throw new Exception("HTTP " + responseCode);
                        }
                    } catch (Exception primaryErr) {
                        if (connection != null) {
                            try { connection.disconnect(); } catch (Exception ignored) {}
                            connection = null;
                        }
                        if (finalFallbackUrl != null
                                && !finalFallbackUrl.trim().isEmpty()
                                && !finalFallbackUrl.equals(finalUrl)) {
                            connection = openVideoConnection(finalFallbackUrl);
                            int fallbackCode = connection.getResponseCode();
                            if (fallbackCode < 200 || fallbackCode >= 300) {
                                call.reject("Video download failed with HTTP " + fallbackCode, "HTTP_ERROR");
                                return;
                            }
                        } else {
                            call.reject("Video download failed: " + primaryErr.getMessage(), "HTTP_ERROR");
                            return;
                        }
                    }

                    String contentType = connection.getContentType();
                    if (contentType != null && contentType.toLowerCase().contains("text/html")) {
                        call.reject("Server returned HTML instead of video media", "INVALID_CONTENT_TYPE");
                        return;
                    }

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                        expectedTotalBytes = connection.getContentLengthLong();
                    } else {
                        expectedTotalBytes = connection.getContentLength();
                    }
                    inputStream = connection.getInputStream();
                }

                ContentValues contentValues = new ContentValues();
                contentValues.put(MediaStore.Video.Media.DISPLAY_NAME, finalFilename);
                contentValues.put(MediaStore.Video.Media.MIME_TYPE, finalMimeType);
                contentValues.put(MediaStore.Video.Media.DATE_ADDED, System.currentTimeMillis() / 1000L);

                File legacyTargetFile = null;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    contentValues.put(
                        MediaStore.Video.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_MOVIES + "/SogoSocial"
                    );
                    contentValues.put(MediaStore.Video.Media.IS_PENDING, 1);
                } else {
                    File moviesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES);
                    File sogoDir = new File(moviesDir, "SogoSocial");
                    if (!sogoDir.exists()) {
                        sogoDir.mkdirs();
                    }
                    legacyTargetFile = new File(sogoDir, finalFilename);
                    contentValues.put(MediaStore.Video.Media.DATA, legacyTargetFile.getAbsolutePath());
                }

                videoUri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, contentValues);
                if (videoUri == null) {
                    call.reject("Could not create MediaStore video entry", "MEDIASTORE_ERROR");
                    return;
                }

                emitVideoProgress(finalVideoId, 0, expectedTotalBytes, 1);

                long totalBytes = 0;
                int lastReportedPercent = 1;
                long lastProgressTime = System.currentTimeMillis();

                try (OutputStream os = resolver.openOutputStream(videoUri)) {
                    if (os == null) {
                        throw new Exception("OutputStream is null for video Uri: " + videoUri);
                    }
                    byte[] buffer = new byte[32768];
                    int bytesRead;
                    while ((bytesRead = inputStream.read(buffer)) != -1) {
                        os.write(buffer, 0, bytesRead);
                        totalBytes += bytesRead;

                        long now = System.currentTimeMillis();
                        if (expectedTotalBytes > 0) {
                            int pct = (int) Math.min(99L, (totalBytes * 100L) / expectedTotalBytes);
                            if (pct > lastReportedPercent && (now - lastProgressTime >= 120 || pct >= 99)) {
                                lastReportedPercent = pct;
                                lastProgressTime = now;
                                emitVideoProgress(finalVideoId, totalBytes, expectedTotalBytes, pct);
                            }
                        } else if (now - lastProgressTime >= 250) {
                            lastProgressTime = now;
                            lastReportedPercent = Math.min(95, lastReportedPercent + 4);
                            emitVideoProgress(finalVideoId, totalBytes, -1, lastReportedPercent);
                        }
                    }
                    os.flush();

                    if (totalBytes == 0) {
                        throw new Exception("Downloaded video file is 0 bytes");
                    }
                } finally {
                    try {
                        inputStream.close();
                    } catch (Exception ignored) {}
                    if (connection != null) {
                        try {
                            connection.disconnect();
                        } catch (Exception ignored) {}
                    }
                }

                // Finalize entry in MediaStore: mark as NOT pending and trigger MediaScanner
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues publishValues = new ContentValues();
                    publishValues.put(MediaStore.Video.Media.IS_PENDING, 0);
                    resolver.update(videoUri, publishValues, null, null);
                } else if (legacyTargetFile != null) {
                    MediaScannerConnection.scanFile(
                        getContext(),
                        new String[]{ legacyTargetFile.getAbsolutePath() },
                        new String[]{ finalMimeType },
                        null
                    );
                }

                emitVideoProgress(finalVideoId, totalBytes, totalBytes, 100);

                JSObject result = new JSObject();
                result.put("success", true);
                result.put("uri", videoUri.toString());
                result.put("location", Environment.DIRECTORY_MOVIES + "/SogoSocial/" + finalFilename);
                result.put("bytesSaved", totalBytes);
                call.resolve(result);

            } catch (Exception e) {
                if (videoUri != null) {
                    try {
                        resolver.delete(videoUri, null, null);
                    } catch (Exception ignored) {}
                }
                call.reject("Error saving Reel to gallery: " + e.getMessage(), "IO_ERROR", e);
            }
        });
    }

    private void executeSave(PluginCall call) {
        String base64Data = call.getString("base64");
        String imageUrl = call.getString("url");
        String filename = call.getString("filename");
        String mimeType = call.getString("mimeType", "image/jpeg");

        if (filename == null || filename.trim().isEmpty()) {
            filename = "sogosocial-image-" + System.currentTimeMillis() + ".jpg";
        }

        if ((base64Data == null || base64Data.trim().isEmpty()) &&
            (imageUrl == null || imageUrl.trim().isEmpty())) {
            call.reject("Neither base64 nor url data provided to save image", "INVALID_INPUT");
            return;
        }

        final String finalFilename = filename;
        final String finalMimeType = (mimeType != null && !mimeType.trim().isEmpty()) ? mimeType : "image/jpeg";
        final String finalBase64 = base64Data;
        final String finalUrl = imageUrl;

        // Perform I/O operations asynchronously in background thread
        bridge.execute(() -> {
            Uri imageUri = null;
            ContentResolver resolver = getContext().getContentResolver();
            try {
                InputStream inputStream = null;
                if (finalBase64 != null && !finalBase64.trim().isEmpty()) {
                    String cleanBase64 = finalBase64;
                    if (cleanBase64.contains(",")) {
                        cleanBase64 = cleanBase64.substring(cleanBase64.indexOf(",") + 1);
                    }
                    byte[] imageBytes = Base64.decode(cleanBase64, Base64.DEFAULT);
                    if (imageBytes == null || imageBytes.length == 0) {
                        call.reject("Decoded image byte buffer is empty", "EMPTY_DATA");
                        return;
                    }
                    inputStream = new ByteArrayInputStream(imageBytes);
                } else {
                    URL u = new URL(finalUrl);
                    HttpURLConnection connection = (HttpURLConnection) u.openConnection();
                    connection.setConnectTimeout(15000);
                    connection.setReadTimeout(15000);
                    connection.connect();
                    int responseCode = connection.getResponseCode();
                    if (responseCode < 200 || responseCode >= 300) {
                        call.reject("HTTP download failed with code " + responseCode, "HTTP_ERROR");
                        return;
                    }
                    inputStream = connection.getInputStream();
                }

                ContentValues contentValues = new ContentValues();
                contentValues.put(MediaStore.Images.Media.DISPLAY_NAME, finalFilename);
                contentValues.put(MediaStore.Images.Media.MIME_TYPE, finalMimeType);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    contentValues.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/SogoSocial");
                    contentValues.put(MediaStore.Images.Media.IS_PENDING, 1);
                } else {
                    File picturesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
                    File sogoDir = new File(picturesDir, "SogoSocial");
                    if (!sogoDir.exists()) {
                        sogoDir.mkdirs();
                    }
                    File targetFile = new File(sogoDir, finalFilename);
                    contentValues.put(MediaStore.Images.Media.DATA, targetFile.getAbsolutePath());
                }

                imageUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues);
                if (imageUri == null) {
                    call.reject("Could not create MediaStore record", "MEDIASTORE_ERROR");
                    return;
                }

                long totalBytes = 0;
                try (OutputStream os = resolver.openOutputStream(imageUri)) {
                    if (os == null) {
                        throw new Exception("OutputStream is null for Uri: " + imageUri);
                    }
                    byte[] buffer = new byte[16384];
                    int bytesRead;
                    while ((bytesRead = inputStream.read(buffer)) != -1) {
                        os.write(buffer, 0, bytesRead);
                        totalBytes += bytesRead;
                    }
                    os.flush();

                    if (totalBytes == 0) {
                        throw new Exception("0 bytes written to destination");
                    }
                } finally {
                    try {
                        inputStream.close();
                    } catch (Exception ignored) {}
                }

                // Finalize entry in MediaStore: mark as NOT pending or scan file
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues publishValues = new ContentValues();
                    publishValues.put(MediaStore.Images.Media.IS_PENDING, 0);
                    resolver.update(imageUri, publishValues, null, null);
                } else {
                    String dataPath = contentValues.getAsString(MediaStore.Images.Media.DATA);
                    if (dataPath != null) {
                        MediaScannerConnection.scanFile(
                            getContext(),
                            new String[]{ dataPath },
                            new String[]{ finalMimeType },
                            null
                        );
                    }
                }

                JSObject result = new JSObject();
                result.put("success", true);
                result.put("uri", imageUri.toString());
                result.put("location", Environment.DIRECTORY_PICTURES + "/SogoSocial/" + finalFilename);
                result.put("bytesSaved", totalBytes);
                call.resolve(result);

            } catch (Exception e) {
                // If anything fails, clean up the incomplete MediaStore item
                if (imageUri != null) {
                    try {
                        resolver.delete(imageUri, null, null);
                    } catch (Exception ignored) {}
                }
                call.reject("Error saving image to gallery: " + e.getMessage(), "IO_ERROR", e);
            }
        });
    }
}
