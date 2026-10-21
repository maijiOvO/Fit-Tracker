package com.myron.fittracker;

import android.app.Activity;
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
     * 返回：{ cancelled: true } 或 { treeUri, dirUri, dirDocId }。
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
        startActivityForResult(call, intent, "pickFolderResult");
    }

    @ActivityCallback
    private void pickFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
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
            call.reject("没能拿到长期授权：" + e.getMessage(), "persist-failed");
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
                            call.reject("没能在选中的文件夹里建子目录 " + sub, "mkdir-failed");
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
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("打开选中的文件夹失败：" + e.getMessage(), "open-failed");
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
            call.reject("缺少 treeUri / dirUri", "bad-args");
            return;
        }
        Uri treeUri = Uri.parse(tree);
        Uri dirUri = Uri.parse(dir);
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, DocumentsContract.getDocumentId(dirUri));
        JSArray files = new JSArray();
        try (Cursor c = getContext().getContentResolver().query(
            children,
            new String[] {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
            },
            null, null, null
        )) {
            if (c != null) {
                while (c.moveToNext()) {
                    String mime = c.getString(4);
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) continue;
                    JSObject f = new JSObject();
                    f.put("uri", DocumentsContract.buildDocumentUriUsingTree(treeUri, c.getString(0)).toString());
                    f.put("name", c.getString(1));
                    f.put("size", c.isNull(2) ? 0 : c.getLong(2));
                    f.put("modified", c.isNull(3) ? 0 : c.getLong(3));
                    files.put(f);
                }
            }
            JSObject ret = new JSObject();
            ret.put("files", files);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("没有这个文件夹的权限了", "no-access");
        } catch (Exception e) {
            call.reject("列文件失败：" + e.getMessage(), "list-failed");
        }
    }

    /** 永远新建文件（不覆盖已有的）。同名时系统会自动改名，返回实际文件名。 */
    @PluginMethod
    public void writeText(PluginCall call) {
        String dir = call.getString("dirUri");
        String name = call.getString("name");
        String text = call.getString("text");
        String mime = call.getString("mimeType", "application/json");
        if (dir == null || name == null || text == null) {
            call.reject("缺少 dirUri / name / text", "bad-args");
            return;
        }
        ContentResolver cr = getContext().getContentResolver();
        try {
            Uri created = DocumentsContract.createDocument(cr, Uri.parse(dir), mime, name);
            if (created == null) {
                call.reject("建文件失败", "create-failed");
                return;
            }
            try (OutputStream out = cr.openOutputStream(created, "w")) {
                if (out == null) throw new IllegalStateException("openOutputStream 返回 null");
                out.write(text.getBytes(StandardCharsets.UTF_8));
                out.flush();
            }
            JSObject ret = new JSObject();
            ret.put("uri", created.toString());
            ret.put("name", queryName(created));
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("没有这个文件夹的权限了", "no-access");
        } catch (Exception e) {
            call.reject("写入失败：" + e.getMessage(), "write-failed");
        }
    }

    @PluginMethod
    public void readText(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) {
            call.reject("缺少 uri", "bad-args");
            return;
        }
        try (InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(uri))) {
            if (in == null) throw new IllegalStateException("openInputStream 返回 null");
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[64 * 1024];
            int n;
            while ((n = in.read(chunk)) != -1) buf.write(chunk, 0, n);
            JSObject ret = new JSObject();
            ret.put("text", new String(buf.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("没有这个文件的权限了", "no-access");
        } catch (Exception e) {
            call.reject("读取失败：" + e.getMessage(), "read-failed");
        }
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) {
            call.reject("缺少 uri", "bad-args");
            return;
        }
        try {
            boolean ok = DocumentsContract.deleteDocument(getContext().getContentResolver(), Uri.parse(uri));
            JSObject ret = new JSObject();
            ret.put("ok", ok);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("删除失败：" + e.getMessage(), "delete-failed");
        }
    }

    // ============ 工具 ============

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
