package com.myron.fittracker;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 备份文件夹：让用户用系统选择器选一次文件夹（存储访问框架），之后长期读写。
 *
 * 为什么自己写：社区插件（@capawesome / @capgo 的 file-picker）只发起选择，
 * 不调 takePersistableUriPermission —— 下次启动就没权限了，也不能在文件夹里读写。
 * 这里只用 DocumentsContract / ContentResolver，不需要任何存储权限声明，
 * 也不需要联网（单机发行版没有 INTERNET 权限，这条不能破）。
 *
 * 卸载后系统会收回授权，所以重装后必须让用户再选一次 —— 这是 Android 11+ 的规矩，
 * 不是这里能绕过的。选择器会直接打开在「文档/fitlog」，两下点击即可。
 */
@CapacitorPlugin(name = "FitlogFolder")
public class FitlogFolderPlugin extends Plugin {

    private static final String EXTERNAL_AUTHORITY = "com.android.externalstorage.documents";

    // ============ 选文件夹 ============

    /**
     * 参数：initial —— 选择器打开的位置（"Documents" / "Documents/fitlog"），只是提示，系统可能不认；
     *      subfolder —— 选中的文件夹不叫这个名字、里面也没有备份时，在里面建 / 复用这个子目录。
     *      purpose —— 'setup' / 'restore'，原样带回：选择器开着时进程被回收，结果走 appRestoredResult 补给 JS，
     *      那时 JS 侧原来等着的 Promise 早没了，只能靠它知道这是哪条流程（Bridge 恢复 PluginCall 时带着原参数）。
     * 返回：{ cancelled: true, purpose } 或 { treeUri, dirUri, dirDocId, purpose }。
     * reject 的 message 只是给 console 的英文诊断，界面按 code 出文案。
     */
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        String initial = call.getString("initial");
        if (initial != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Uri initialUri = DocumentsContract.buildDocumentUri(EXTERNAL_AUTHORITY, "primary:" + initial);
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialUri);
        }
        // 不用 resolveActivity 先判空：targetSdk 35、清单没写 <queries>，装了 DocumentsUI 的机器也会被判成没有。
        // 起不来的异常漏到插件线程会被 Capacitor rethrow、整个 App 闪退，所以这里接住
        try {
            startActivityForResult(call, intent, "pickFolderResult");
        } catch (ActivityNotFoundException e) {
            call.reject("no activity handles ACTION_OPEN_DOCUMENT_TREE", "unsupported");
        } catch (RuntimeException e) {
            call.reject("could not open the folder picker: " + e, "open-failed");
        }
    }

    @ActivityCallback
    private void pickFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        String purpose = call.getString("purpose");
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            ret.put("purpose", purpose);
            call.resolve(ret);
            return;
        }
        Uri treeUri = result.getData().getData();
        ContentResolver cr = getContext().getContentResolver();
        try {
            cr.takePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (SecurityException e) {
            call.reject("takePersistableUriPermission failed: " + e.getMessage(), "persist-failed");
            return;
        }

        try {
            String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
            String dirDocId = rootDocId;
            String sub = call.getString("subfolder");
            if (sub != null && !sub.isEmpty()) {
                String rootName = lastSegment(rootDocId);
                boolean useRoot = sub.equalsIgnoreCase(rootName) || hasBackupFiles(treeUri, rootDocId);
                if (!useRoot) {
                    String childId = findChildDir(treeUri, rootDocId, sub);
                    if (childId == null) {
                        Uri parent = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootDocId);
                        Uri created = DocumentsContract.createDocument(cr, parent, DocumentsContract.Document.MIME_TYPE_DIR, sub);
                        if (created == null) {
                            call.reject("createDocument returned null for subfolder " + sub, "mkdir-failed");
                            return;
                        }
                        childId = DocumentsContract.getDocumentId(created);
                    }
                    dirDocId = childId;
                }
            }
            JSObject ret = new JSObject();
            ret.put("treeUri", treeUri.toString());
            ret.put("dirUri", DocumentsContract.buildDocumentUriUsingTree(treeUri, dirDocId).toString());
            ret.put("dirDocId", dirDocId);
            ret.put("purpose", purpose);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("opening the picked folder failed: " + e, "open-failed");
        }
    }

    // ============ 授权检查 ============

    @PluginMethod
    public void hasAccess(PluginCall call) {
        String tree = call.getString("treeUri");
        boolean ok = false;
        if (tree != null) {
            for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
                if (p.getUri().toString().equals(tree) && p.isReadPermission() && p.isWritePermission()) {
                    ok = true;
                    break;
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("ok", ok);
        call.resolve(ret);
    }

    // ============ 列 / 读 / 写 / 删 ============

    @PluginMethod
    public void list(PluginCall call) {
        String tree = call.getString("treeUri");
        String dir = call.getString("dirUri");
        if (tree == null || dir == null) {
            call.reject("missing treeUri / dirUri", "bad-args");
            return;
        }
        Uri treeUri = Uri.parse(tree);
        Uri dirUri = Uri.parse(dir);
        JSArray files = new JSArray();
        // getDocumentId 也在 try 里：uri 不对时它抛 IllegalArgumentException，漏出去会让 App 闪退
        try (Cursor c = getContext().getContentResolver().query(
            DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, DocumentsContract.getDocumentId(dirUri)),
            new String[] {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
            },
            null, null, null
        )) {
            // 目录被删 / 改名 / 存储卡拔了：DocumentsProvider 把 FileNotFoundException 吞成 null 游标，不抛
            if (c == null) throw new IllegalStateException("children query returned null");
            while (c.moveToNext()) {
                String mime = c.getString(4);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) continue;
                JSObject f = new JSObject();
                f.put("uri", DocumentsContract.buildDocumentUriUsingTree(treeUri, c.getString(0)).toString());
                f.put("name", c.getString(1));
                // -1 = provider 没报大小（未知）。不能报 0：保留规则把 0 字节当写坏的文件直接删
                f.put("size", c.isNull(2) ? -1 : c.getLong(2));
                f.put("modified", c.isNull(3) ? 0 : c.getLong(3));
                files.put(f);
            }
            JSObject ret = new JSObject();
            ret.put("files", files);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("no permission for this folder", "no-access");
        } catch (Exception e) {
            String why = dirPresent(dirUri);
            call.reject("list failed: " + e, why != null ? why : "list-failed");
        }
    }

    /** 永远新建文件（不覆盖已有的）。同名时系统会自动改名，返回实际文件名。写不成就删掉建了一半的那份 */
    @PluginMethod
    public void writeText(PluginCall call) {
        String dir = call.getString("dirUri");
        String name = call.getString("name");
        String text = call.getString("text");
        String mime = call.getString("mimeType", "application/json");
        if (dir == null || name == null || text == null) {
            call.reject("missing dirUri / name / text", "bad-args");
            return;
        }
        ContentResolver cr = getContext().getContentResolver();
        Uri dirUri = Uri.parse(dir);
        Uri created = null;
        try {
            created = DocumentsContract.createDocument(cr, dirUri, mime, name);
            if (created == null) throw new IllegalStateException("createDocument returned null");
            try (OutputStream out = cr.openOutputStream(created, "w")) {
                if (out == null) throw new IllegalStateException("openOutputStream returned null");
                out.write(text.getBytes(StandardCharsets.UTF_8));
                out.flush();
            }
            JSObject ret = new JSObject();
            ret.put("uri", created.toString());
            ret.put("name", queryName(created));
            call.resolve(ret);
        } catch (Exception e) {
            // 只删本次 createDocument 返回的那个 uri。进程在写的中途被杀时这里不会执行，由 JS 侧的写前标记下次清（fitlogAutoBackup）
            if (created != null) {
                try {
                    DocumentsContract.deleteDocument(cr, created);
                } catch (Exception ignored) {
                    // 尽力而为
                }
            }
            if (e instanceof SecurityException) {
                call.reject("no permission for this folder", "no-access");
                return;
            }
            String why = dirPresent(dirUri);
            call.reject("write failed: " + e, why != null ? why : created == null ? "create-failed" : "write-failed");
        }
    }

    @PluginMethod
    public void readText(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) {
            call.reject("missing uri", "bad-args");
            return;
        }
        try (InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(uri))) {
            if (in == null) throw new IllegalStateException("openInputStream returned null");
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[64 * 1024];
            int n;
            while ((n = in.read(chunk)) != -1) buf.write(chunk, 0, n);
            JSObject ret = new JSObject();
            ret.put("text", new String(buf.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("no permission for this file", "no-access");
        } catch (Exception e) {
            call.reject("read failed: " + e, "read-failed");
        }
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) {
            call.reject("missing uri", "bad-args");
            return;
        }
        try {
            boolean ok = DocumentsContract.deleteDocument(getContext().getContentResolver(), Uri.parse(uri));
            JSObject ret = new JSObject();
            ret.put("ok", ok);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("delete failed: " + e, "delete-failed");
        }
    }

    // ============ 工具 ============

    /**
     * 目录文档本身还在不在：在返回 null；查不到行、MIME 不是目录、或查询抛错算 folder-missing，没权限算 no-access。
     * 只看授权（hasAccess）不够：目录被删 / 改名 / 存储卡拔了，授权照样列在 getPersistedUriPermissions 里。
     */
    private String dirPresent(Uri dirUri) {
        try (Cursor c = getContext().getContentResolver().query(
            dirUri, new String[] { DocumentsContract.Document.COLUMN_MIME_TYPE }, null, null, null
        )) {
            if (c != null && c.moveToFirst() && DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(0))) return null;
            return "folder-missing";
        } catch (SecurityException e) {
            return "no-access";
        } catch (Exception e) {
            return "folder-missing";
        }
    }

    private static String lastSegment(String docId) {
        int colon = docId.indexOf(':');
        String path = colon >= 0 ? docId.substring(colon + 1) : docId;
        int slash = path.lastIndexOf('/');
        return slash >= 0 ? path.substring(slash + 1) : path;
    }

    private boolean hasBackupFiles(Uri treeUri, String dirDocId) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, dirDocId);
        try (Cursor c = getContext().getContentResolver().query(
            children, new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null
        )) {
            if (c == null) return false;
            while (c.moveToNext()) {
                String n = c.getString(0);
                if (n != null && n.toLowerCase().endsWith(".json")
                    && (n.startsWith("fitlog-") || n.startsWith("FitTracker_Backup_"))) return true;
            }
        } catch (Exception ignored) {
            // 列不出来就当没有，走建子目录那条路
        }
        return false;
    }

    private String findChildDir(Uri treeUri, String parentDocId, String name) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId);
        try (Cursor c = getContext().getContentResolver().query(
            children,
            new String[] {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
            },
            null, null, null
        )) {
            if (c == null) return null;
            while (c.moveToNext()) {
                if (name.equalsIgnoreCase(c.getString(1)) && DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2))) {
                    return c.getString(0);
                }
            }
        }
        return null;
    }

    private String queryName(Uri doc) {
        try (Cursor c = getContext().getContentResolver().query(
            doc, new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null
        )) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {
            // 查不到名字不影响写入结果
        }
        return null;
    }
}
