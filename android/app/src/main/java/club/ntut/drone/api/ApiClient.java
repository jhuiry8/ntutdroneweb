package club.ntut.drone.api;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.text.Html;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import club.ntut.drone.model.Equipment;
import club.ntut.drone.model.Meeting;
import club.ntut.drone.model.Post;
import club.ntut.drone.model.User;

/**
 * Talks to the club's Cloudflare Worker. Every call reports failures through
 * {@link ApiCallback#onError}; nothing is ever faked as a success and no sample
 * data is substituted for real data.
 */
public class ApiClient {
    public static final String BASE_URL = "https://ntut.tpe.pp.ua";
    public static final String LOAN_FORM_URL = BASE_URL + "/forms/equipment-loan";

    private static final String PREF_NAME = "drone_club_prefs";
    private static final String KEY_COOKIE = "session_cookie";
    private static final Pattern LOGIN_ERROR = Pattern.compile("alert-circle\"[^>]*></i>\\s*([^<]+)</div>");

    private static ApiClient instance;
    private final SharedPreferences prefs;
    private final ExecutorService executor;
    private final Handler mainHandler;

    public interface ApiCallback<T> {
        void onSuccess(T result);
        void onError(String error);
    }

    /** Thrown for any non-success HTTP status; {@code status} is the HTTP code (0 for network failures). */
    public static class ApiException extends Exception {
        public final int status;
        public ApiException(int status, String message) { super(message); this.status = status; }
    }

    /** A CAPTCHA challenge from POST /api/captcha. */
    public static class Captcha {
        public final String id;
        public final String svg;
        Captcha(String id, String svg) { this.id = id; this.svg = svg; }
    }

    private static class HttpResult {
        final int code;
        final String body;
        HttpResult(int code, String body) { this.code = code; this.body = body; }
    }

    private interface Task<T> { T run() throws Exception; }

    private ApiClient(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        this.executor = Executors.newFixedThreadPool(4);
        this.mainHandler = new Handler(Looper.getMainLooper());
    }

    public static synchronized ApiClient getInstance(Context context) {
        if (instance == null) instance = new ApiClient(context);
        return instance;
    }

    private String getSavedCookie() { return prefs.getString(KEY_COOKIE, ""); }

    public void clearSession() { prefs.edit().remove(KEY_COOKIE).apply(); }

    public boolean isLoggedIn() { return !getSavedCookie().isEmpty(); }

    private <T> void runAsync(Task<T> task, ApiCallback<T> callback) {
        executor.execute(() -> {
            try {
                T result = task.run();
                mainHandler.post(() -> callback.onSuccess(result));
            } catch (ApiException e) {
                if (e.status == 401) clearSession();
                String message = e.getMessage();
                mainHandler.post(() -> callback.onError(message));
            } catch (IOException e) {
                mainHandler.post(() -> callback.onError("無法連線到伺服器，請檢查網路後再試"));
            } catch (Exception e) {
                mainHandler.post(() -> callback.onError("伺服器回應格式錯誤：" + e.getMessage()));
            }
        });
    }

    private HttpResult request(String endpoint, String method, String contentType, String body) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(BASE_URL + endpoint).openConnection();
        try {
            conn.setRequestMethod(method);
            // Keep 302 responses (login) so their Set-Cookie header is not lost to the redirect.
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("User-Agent", "NTUTDroneAndroidApp/2.0");
            conn.setRequestProperty("Accept", "application/json");
            String cookie = getSavedCookie();
            if (!cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);

            if (body != null) {
                conn.setRequestProperty("Content-Type", contentType);
                conn.setDoOutput(true);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.getBytes(StandardCharsets.UTF_8));
                }
            }

            int code = conn.getResponseCode();
            List<String> cookies = conn.getHeaderFields().get("Set-Cookie");
            if (cookies != null) {
                for (String c : cookies) {
                    if (!c.startsWith("session=")) continue;
                    String value = c.split(";", 2)[0];
                    if (value.equals("session=") || c.toLowerCase().contains("max-age=0")) clearSession();
                    else prefs.edit().putString(KEY_COOKIE, value).apply();
                    break;
                }
            }

            InputStream is = code < 400 ? conn.getInputStream() : conn.getErrorStream();
            StringBuilder sb = new StringBuilder();
            if (is != null) {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) sb.append(line).append('\n');
                }
            }
            return new HttpResult(code, sb.toString());
        } finally {
            conn.disconnect();
        }
    }

    private HttpResult getJson(String endpoint) throws IOException {
        return request(endpoint, "GET", null, null);
    }

    private HttpResult postJson(String endpoint, JSONObject payload) throws IOException {
        return request(endpoint, "POST", "application/json; charset=UTF-8", payload == null ? "{}" : payload.toString());
    }

    /** Throws an ApiException carrying the server's error message unless the status is 2xx. */
    private static String ok(HttpResult res, String unauthorizedMessage, String forbiddenMessage) throws ApiException {
        if (res.code >= 200 && res.code < 300) return res.body;
        String serverMessage = "";
        try { serverMessage = new JSONObject(res.body).optString("error", ""); } catch (Exception ignored) { }
        if (res.code == 401) throw new ApiException(401, unauthorizedMessage);
        if (res.code == 403 && forbiddenMessage != null) throw new ApiException(403, forbiddenMessage);
        throw new ApiException(res.code, serverMessage.isEmpty() ? "伺服器錯誤（HTTP " + res.code + "）" : serverMessage);
    }

    private static String date(String iso) {
        return iso != null && iso.length() >= 10 ? iso.substring(0, 10) : (iso == null ? "" : iso);
    }

    public void fetchAnnouncements(ApiCallback<List<Post>> callback) {
        runAsync(() -> {
            String body = ok(getJson("/api/announcements"), "請先登入社員帳號以查看社內公告", null);
            JSONArray arr = new JSONArray(body);
            List<Post> list = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.getJSONObject(i);
                list.add(new Post(
                        item.optString("id"),
                        item.optString("title"),
                        item.optString("content"),
                        date(item.optString("createdAt")),
                        item.optBoolean("pinned") ? "置頂" : (item.optBoolean("read") ? "公告" : "未讀")
                ));
            }
            return list;
        }, callback);
    }

    public void fetchEquipment(ApiCallback<List<Equipment>> callback) {
        runAsync(() -> {
            String body = ok(getJson("/api/equipment"), "請先登入幹部帳號以查看設備清單",
                    "設備清單僅限幹部查看；一般社員請使用線上借用表單");
            JSONArray arr = new JSONArray(body);
            List<Equipment> list = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.getJSONObject(i);
                list.add(new Equipment(
                        item.optString("id"),
                        item.optString("assetName"),
                        item.optString("category"),
                        item.optString("status", "storage"),
                        item.optString("location")
                ));
            }
            return list;
        }, callback);
    }

    public void fetchMeetings(ApiCallback<List<Meeting>> callback) {
        runAsync(() -> {
            JSONObject root = new JSONObject(ok(getJson("/api/meetings"), "請先登入社員帳號以查看會議", null));
            JSONArray arr = root.optJSONArray("meetings");
            List<Meeting> list = new ArrayList<>();
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject item = arr.getJSONObject(i);
                    list.add(new Meeting(
                            item.optString("id"),
                            item.optString("title"),
                            item.optString("date"),
                            item.optString("status"),
                            item.optString("statusLabel"),
                            item.optString("typeLabel"),
                            item.optBoolean("checkedIn"),
                            item.optBoolean("requiresCode")
                    ));
                }
            }
            return list;
        }, callback);
    }

    /** Self check-in for the logged-in member (POST /api/meetings/:id/attendance). */
    public void checkIn(String meetingId, String code, ApiCallback<String> callback) {
        runAsync(() -> {
            JSONObject payload = new JSONObject();
            if (code != null && !code.isEmpty()) payload.put("code", code);
            String path = "/api/meetings/" + URLEncoder.encode(meetingId, "UTF-8") + "/attendance";
            ok(postJson(path, payload), "登入已過期，請重新登入後再簽到", null);
            return "簽到成功！";
        }, callback);
    }

    /** Fetches a single-use image CAPTCHA for login. */
    public void fetchCaptcha(ApiCallback<Captcha> callback) {
        runAsync(() -> {
            HttpResult res = postJson("/api/captcha", null);
            if (res.code == 404) {
                throw new ApiException(404, "伺服器使用 Cloudflare Turnstile 驗證，App 無法直接登入，請改用網頁版登入");
            }
            JSONObject root = new JSONObject(ok(res, "無法取得驗證碼", null));
            return new Captcha(root.getString("id"), root.getString("svg"));
        }, callback);
    }

    public void login(String username, String password, String captchaId, String captcha, ApiCallback<User> callback) {
        runAsync(() -> {
            String form = "username=" + URLEncoder.encode(username, "UTF-8")
                    + "&password=" + URLEncoder.encode(password, "UTF-8")
                    + "&captcha_id=" + URLEncoder.encode(captchaId, "UTF-8")
                    + "&captcha=" + URLEncoder.encode(captcha, "UTF-8");
            clearSession();
            HttpResult res = request("/api/login", "POST", "application/x-www-form-urlencoded; charset=UTF-8", form);
            // Success is a 302 to the dashboard carrying the session cookie; failures re-render the login page.
            if (res.code != 302 || !isLoggedIn()) {
                Matcher m = LOGIN_ERROR.matcher(res.body);
                String message = m.find() ? Html.fromHtml(m.group(1).trim()).toString() : "";
                if (message.isEmpty()) message = res.code == 429 ? "登入嘗試過多，請稍後再試" : "登入失敗（HTTP " + res.code + "）";
                throw new ApiException(res.code, message);
            }
            return loadMe();
        }, callback);
    }

    private User loadMe() throws Exception {
        JSONObject root = new JSONObject(ok(getJson("/api/me"), "尚未登入", null));
        JSONObject member = root.optJSONObject("member");
        String name = member != null ? member.optString("name", "") : "";
        String username = root.optString("username");
        return new User(username, root.optString("role"), name.isEmpty() ? username : name);
    }

    /** Loads the logged-in user; reports an error (and clears the stored cookie) when the session is invalid. */
    public void fetchMe(ApiCallback<User> callback) {
        runAsync(this::loadMe, callback);
    }

    /** Ends the session on the server, then forgets it locally even if the server could not be reached. */
    public void logout(ApiCallback<Void> callback) {
        executor.execute(() -> {
            try {
                if (isLoggedIn()) postJson("/api/logout", null);
            } catch (IOException ignored) {
                // Offline: the local cookie is still removed below; the server session expires on its own.
            } finally {
                clearSession();
                mainHandler.post(() -> callback.onSuccess(null));
            }
        });
    }
}
