package com.lookleft.labelpeel;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The page's "labelpeel" printer bridge on Android, matching the iOS app's
 * messages: {op: "connect", kind: "bluetooth" | "usb"} → {name, productId?},
 * {op: "write", data: base64},
 * {op: "read", timeoutMs} → base64, {op: "close"}. Android talks to Bluetooth
 * Classic printers like the PT-E560BT over an RFCOMM socket using the Serial
 * Port Profile. Replies go back through window.__labelpeelReply(id, result, error).
 */
public class PrinterBridge {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");
    private static final int REQ_BLUETOOTH = 10;

    private final Activity activity;
    private final WebView webView;
    /** One worker so connect, write and close run in order. */
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private BluetoothSocket socket;
    private OutputStream out;
    private Thread reader;
    private final ByteArrayOutputStream inBuffer = new ByteArrayOutputStream();
    private String permissionReplyId;

    // USB: a Brother printer's USB printer-class interface.
    private static final int BROTHER_VENDOR_ID = 0x04f9;
    private static final String ACTION_USB_PERMISSION = "com.lookleft.labelpeel.USB_PERMISSION";
    private UsbDeviceConnection usbConnection;
    private UsbInterface usbInterface;
    private UsbEndpoint usbOut;

    PrinterBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    @JavascriptInterface
    public void postMessage(String json, String id) {
        try {
            JSONObject msg = new JSONObject(json);
            switch (msg.optString("op")) {
                case "connect":
                    if ("usb".equals(msg.optString("kind"))) connectUsb(id);
                    else connect(id);
                    break;
                case "write":
                    byte[] data = Base64.decode(msg.getString("data"), Base64.DEFAULT);
                    worker.execute(() -> write(id, data));
                    break;
                case "read":
                    long timeout = msg.optLong("timeoutMs", 1000);
                    // Reads wait on their own thread so they don't hold up writes.
                    new Thread(() -> read(id, timeout)).start();
                    break;
                case "close":
                    worker.execute(() -> {
                        close();
                        reply(id, "true", null);
                    });
                    break;
                default:
                    reply(id, null, "Unknown op " + msg.optString("op"));
            }
        } catch (JSONException e) {
            reply(id, null, "Bad message");
        }
    }

    /** Downloads from the page: the web view can't save in-page files itself. */
    @JavascriptInterface
    public void saveFile(String name, String mime, String base64) {
        ((MainActivity) activity).saveFile(name, mime, base64);
    }

    // ---- Connect (USB)

    private void connectUsb(String id) {
        UsbManager manager = (UsbManager) activity.getSystemService(Context.USB_SERVICE);
        UsbDevice device = null;
        if (manager != null) {
            for (UsbDevice d : manager.getDeviceList().values()) {
                if (d.getVendorId() == BROTHER_VENDOR_ID && printerInterface(d) != null) {
                    device = d;
                    break;
                }
            }
        }
        if (device == null) {
            reply(id, null, "No Brother printer found on USB. Connect it with a USB cable (a USB-C OTG adapter on most phones) and switch it on.");
            return;
        }
        if (manager.hasPermission(device)) {
            UsbDevice d = device;
            worker.execute(() -> openUsb(id, manager, d));
            return;
        }
        // Ask Android for access to the printer; the answer comes back as a broadcast.
        UsbDevice target = device;
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                activity.unregisterReceiver(this);
                if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) worker.execute(() -> openUsb(id, manager, target));
                else reply(id, null, "USB access to the printer was not allowed.");
            }
        };
        IntentFilter filter = new IntentFilter(ACTION_USB_PERMISSION);
        if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else activity.registerReceiver(receiver, filter);
        Intent intent = new Intent(ACTION_USB_PERMISSION).setPackage(activity.getPackageName());
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        manager.requestPermission(device, PendingIntent.getBroadcast(activity, 0, intent, flags));
    }

    private static UsbInterface printerInterface(UsbDevice device) {
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface iface = device.getInterface(i);
            if (iface.getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER) return iface;
        }
        return null;
    }

    private void openUsb(String id, UsbManager manager, UsbDevice device) {
        close();
        UsbInterface iface = printerInterface(device);
        UsbEndpoint outEp = null;
        UsbEndpoint inEp = null;
        for (int i = 0; iface != null && i < iface.getEndpointCount(); i++) {
            UsbEndpoint ep = iface.getEndpoint(i);
            if (ep.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
            if (ep.getDirection() == UsbConstants.USB_DIR_OUT) outEp = ep;
            else inEp = ep;
        }
        UsbDeviceConnection conn = outEp == null ? null : manager.openDevice(device);
        if (conn == null || !conn.claimInterface(iface, true)) {
            if (conn != null) conn.close();
            reply(id, null, "Could not open the printer on USB. Unplug it, plug it back in and try again.");
            return;
        }
        usbConnection = conn;
        usbInterface = iface;
        usbOut = outEp;
        if (inEp != null) startUsbReader(conn, inEp);
        try {
            String name = device.getProductName();
            reply(id, new JSONObject().put("name", name == null ? "Brother printer" : name).put("productId", device.getProductId()).toString(), null);
        } catch (JSONException e) {
            reply(id, "{}", null);
        }
    }

    private void startUsbReader(UsbDeviceConnection conn, UsbEndpoint in) {
        reader = new Thread(() -> {
            byte[] buf = new byte[Math.max(64, in.getMaxPacketSize())];
            while (usbConnection == conn) {
                // Short timeouts so the loop notices when the connection closes.
                int n = conn.bulkTransfer(in, buf, buf.length, 200);
                if (n > 0) {
                    synchronized (inBuffer) {
                        inBuffer.write(buf, 0, n);
                        inBuffer.notifyAll();
                    }
                }
            }
        });
        reader.start();
    }

    // ---- Connect (Bluetooth)

    private void connect(String id) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            permissionReplyId = id;
            activity.runOnUiThread(() -> activity.requestPermissions(new String[] {Manifest.permission.BLUETOOTH_CONNECT}, REQ_BLUETOOTH));
            return;
        }
        chooseDevice(id);
    }

    void onPermissionResult(int requestCode, int[] grantResults) {
        if (requestCode != REQ_BLUETOOTH || permissionReplyId == null) return;
        String id = permissionReplyId;
        permissionReplyId = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) chooseDevice(id);
        else reply(id, null, "Labelpeel needs the Nearby devices permission to use a Bluetooth printer. Allow it in Settings → Apps → Labelpeel → Permissions.");
    }

    @SuppressLint("MissingPermission") // Checked in connect().
    private void chooseDevice(String id) {
        BluetoothManager manager = (BluetoothManager) activity.getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null) {
            reply(id, null, "This device has no Bluetooth.");
            return;
        }
        if (!adapter.isEnabled()) {
            reply(id, null, "Bluetooth is off. Turn it on and try again.");
            return;
        }
        // Brother label printers advertise names like "PT-E560BT1234".
        List<BluetoothDevice> printers = new ArrayList<>();
        for (BluetoothDevice d : adapter.getBondedDevices()) {
            String name = d.getName();
            if (name != null && name.toUpperCase().startsWith("PT-")) printers.add(d);
        }
        if (printers.isEmpty()) {
            activity.runOnUiThread(() -> activity.startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)));
            reply(id, null, "No paired Brother printer found. Pair the printer in Bluetooth settings (opened for you), then tap Bluetooth printer again.");
            return;
        }
        if (printers.size() == 1) {
            worker.execute(() -> open(id, adapter, printers.get(0)));
            return;
        }
        String[] names = new String[printers.size()];
        for (int i = 0; i < names.length; i++) names[i] = printers.get(i).getName();
        activity.runOnUiThread(() -> new AlertDialog.Builder(activity)
                .setTitle("Choose a printer")
                .setItems(names, (dialog, which) -> worker.execute(() -> open(id, adapter, printers.get(which))))
                .setOnCancelListener((dialog) -> reply(id, null, "No printer selected."))
                .show());
    }

    @SuppressLint("MissingPermission")
    private void open(String id, BluetoothAdapter adapter, BluetoothDevice device) {
        close();
        adapter.cancelDiscovery();
        BluetoothSocket s = null;
        try {
            try {
                s = device.createRfcommSocketToServiceRecord(SPP);
                s.connect();
            } catch (IOException first) {
                // Some printers only accept an unauthenticated link.
                if (s != null) closeQuietly(s);
                s = device.createInsecureRfcommSocketToServiceRecord(SPP);
                s.connect();
            }
            socket = s;
            out = s.getOutputStream();
            startReader(s.getInputStream());
            String name = device.getName();
            reply(id, new JSONObject().put("name", name == null ? "Brother printer" : name).toString(), null);
        } catch (IOException | JSONException e) {
            if (s != null) closeQuietly(s);
            reply(id, null, "Could not connect to " + device.getName() + ". Check it's switched on and not connected to another phone or app, then try again.");
        }
    }

    private void startReader(InputStream in) {
        reader = new Thread(() -> {
            byte[] buf = new byte[1024];
            try {
                int n;
                while ((n = in.read(buf)) > 0) {
                    synchronized (inBuffer) {
                        inBuffer.write(buf, 0, n);
                        inBuffer.notifyAll();
                    }
                }
            } catch (IOException ignored) {
                // Socket closed.
            }
            if (socket != null) {
                close();
                notifyDisconnect();
            }
        });
        reader.start();
    }

    // ---- Write / read

    private void write(String id, byte[] data) {
        UsbDeviceConnection usb = usbConnection;
        if (usb != null) {
            for (int offset = 0; offset < data.length; ) {
                int sent = usb.bulkTransfer(usbOut, data, offset, Math.min(16384, data.length - offset), 10000);
                if (sent <= 0) {
                    close();
                    notifyDisconnect();
                    reply(id, null, "USB transfer failed. Check the cable and that the printer is on.");
                    return;
                }
                offset += sent;
            }
            reply(id, "true", null);
            return;
        }
        if (out == null) {
            reply(id, null, "Printer not connected.");
            return;
        }
        try {
            out.write(data);
            out.flush();
            reply(id, "true", null);
        } catch (IOException e) {
            close();
            reply(id, null, "Printer disconnected.");
        }
    }

    private void read(String id, long timeoutMs) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        byte[] bytes;
        synchronized (inBuffer) {
            while (inBuffer.size() < 32 && (socket != null || usbConnection != null)) {
                long left = deadline - System.currentTimeMillis();
                if (left <= 0) break;
                try {
                    inBuffer.wait(left);
                } catch (InterruptedException e) {
                    break;
                }
            }
            bytes = inBuffer.toByteArray();
            inBuffer.reset();
        }
        reply(id, JSONObject.quote(Base64.encodeToString(bytes, Base64.NO_WRAP)), null);
    }

    // ---- Close

    void close() {
        UsbDeviceConnection usb = usbConnection;
        usbConnection = null;
        if (usb != null) {
            usb.releaseInterface(usbInterface);
            usb.close();
        }
        BluetoothSocket s = socket;
        socket = null;
        out = null;
        if (s != null) closeQuietly(s);
        synchronized (inBuffer) {
            inBuffer.reset();
            inBuffer.notifyAll();
        }
    }

    private static void closeQuietly(BluetoothSocket s) {
        try {
            s.close();
        } catch (IOException ignored) {
            // Already closed.
        }
    }

    private void notifyDisconnect() {
        activity.runOnUiThread(() -> webView.evaluateJavascript("window.__labelpeelNativeDisconnect && window.__labelpeelNativeDisconnect()", null));
    }

    /** Resolve the page's promise. `result` is a JSON literal. */
    private void reply(String id, String result, String error) {
        String js = "window.__labelpeelReply && window.__labelpeelReply(" + JSONObject.quote(id) + ", "
                + (result == null ? "null" : result) + ", " + (error == null ? "null" : JSONObject.quote(error)) + ")";
        activity.runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }
}
