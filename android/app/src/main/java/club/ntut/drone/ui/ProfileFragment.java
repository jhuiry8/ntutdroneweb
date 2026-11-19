package club.ntut.drone.ui;

import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.drawable.PictureDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import com.caverock.androidsvg.SVG;

import club.ntut.drone.R;
import club.ntut.drone.api.ApiClient;
import club.ntut.drone.model.User;

public class ProfileFragment extends Fragment {
    private TextView tvName;
    private TextView tvRole;
    private Button btnAuth;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_profile, container, false);

        tvName = view.findViewById(R.id.tv_profile_name);
        tvRole = view.findViewById(R.id.tv_profile_role);
        btnAuth = view.findViewById(R.id.btn_profile_auth);

        btnAuth.setOnClickListener(v -> {
            if (getContext() == null) return;
            ApiClient api = ApiClient.getInstance(getContext());
            if (api.isLoggedIn()) {
                btnAuth.setEnabled(false);
                api.logout(new ApiClient.ApiCallback<Void>() {
                    @Override
                    public void onSuccess(Void result) {
                        if (!isAdded()) return;
                        btnAuth.setEnabled(true);
                        updateUserUI(User.guest());
                        Toast.makeText(getContext(), "已登出", Toast.LENGTH_SHORT).show();
                    }

                    @Override
                    public void onError(String error) {
                        if (!isAdded()) return;
                        btnAuth.setEnabled(true);
                        updateUserUI(User.guest());
                    }
                });
            } else {
                showLoginDialog();
            }
        });

        view.findViewById(R.id.btn_profile_line).setOnClickListener(v ->
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://lin.ee/s5YJgGI"))));

        view.findViewById(R.id.btn_profile_ig).setOnClickListener(v ->
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.instagram.com/ntut_drone/"))));

        view.findViewById(R.id.btn_profile_email).setOnClickListener(v -> {
            Intent intent = new Intent(Intent.ACTION_SENDTO);
            intent.setData(Uri.parse("mailto:ntut.droneclub@gmail.com"));
            intent.putExtra(Intent.EXTRA_SUBJECT, "【北科無人機社】諮詢洽詢");
            startActivity(Intent.createChooser(intent, "寄送電子郵件"));
        });

        loadUserInfo();
        return view;
    }

    private void loadUserInfo() {
        if (getContext() == null) return;
        ApiClient api = ApiClient.getInstance(getContext());
        updateUserUI(User.guest());
        if (!api.isLoggedIn()) return;
        api.fetchMe(new ApiClient.ApiCallback<User>() {
            @Override
            public void onSuccess(User result) {
                if (isAdded()) updateUserUI(result);
            }

            @Override
            public void onError(String error) {
                if (!isAdded()) return;
                updateUserUI(User.guest());
                Toast.makeText(getContext(), error, Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void updateUserUI(User user) {
        tvName.setText(user.getName());
        tvRole.setText("社團身份：" + user.getRoleLabel());
        boolean loggedIn = getContext() != null && ApiClient.getInstance(getContext()).isLoggedIn();
        btnAuth.setText(loggedIn ? "登出帳號" : "社員 / 幹部登入");
    }

    private void showLoginDialog() {
        if (getContext() == null) return;

        View dialogView = LayoutInflater.from(getContext()).inflate(R.layout.dialog_login, null);
        EditText etUsername = dialogView.findViewById(R.id.et_login_username);
        EditText etPassword = dialogView.findViewById(R.id.et_login_password);
        EditText etCaptcha = dialogView.findViewById(R.id.et_login_captcha);
        ImageView ivCaptcha = dialogView.findViewById(R.id.iv_login_captcha);
        TextView tvCaptchaHint = dialogView.findViewById(R.id.tv_login_captcha_hint);
        final String[] captchaId = {""};

        Runnable loadCaptcha = () -> {
            captchaId[0] = "";
            etCaptcha.setText("");
            tvCaptchaHint.setText("驗證碼載入中…");
            ApiClient.getInstance(requireContext()).fetchCaptcha(new ApiClient.ApiCallback<ApiClient.Captcha>() {
                @Override
                public void onSuccess(ApiClient.Captcha result) {
                    if (!isAdded()) return;
                    try {
                        PictureDrawable drawable = new PictureDrawable(SVG.getFromString(result.svg).renderToPicture());
                        ivCaptcha.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
                        ivCaptcha.setImageDrawable(drawable);
                        captchaId[0] = result.id;
                        tvCaptchaHint.setText("點擊圖片可更換驗證碼");
                    } catch (Exception e) {
                        tvCaptchaHint.setText("驗證碼圖片無法顯示，點擊重試");
                    }
                }

                @Override
                public void onError(String error) {
                    if (isAdded()) tvCaptchaHint.setText(error + "（點擊重試）");
                }
            });
        };
        ivCaptcha.setOnClickListener(v -> loadCaptcha.run());
        tvCaptchaHint.setOnClickListener(v -> loadCaptcha.run());

        AlertDialog dialog = new AlertDialog.Builder(getContext(), android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setView(dialogView)
                .setPositiveButton("登入", null)
                .setNegativeButton("取消", null)
                .create();

        // Override the positive button so a failed login keeps the dialog (and typed username) open.
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String username = etUsername.getText().toString().trim();
            String password = etPassword.getText().toString();
            String captcha = etCaptcha.getText().toString().trim();
            if (username.isEmpty() || password.isEmpty()) {
                Toast.makeText(getContext(), "請輸入帳號與密碼", Toast.LENGTH_SHORT).show();
                return;
            }
            if (captchaId[0].isEmpty() || captcha.isEmpty()) {
                Toast.makeText(getContext(), "請輸入驗證碼", Toast.LENGTH_SHORT).show();
                return;
            }
            Button positive = dialog.getButton(AlertDialog.BUTTON_POSITIVE);
            positive.setEnabled(false);
            ApiClient.getInstance(requireContext()).login(username, password, captchaId[0], captcha, new ApiClient.ApiCallback<User>() {
                @Override
                public void onSuccess(User result) {
                    if (!isAdded()) return;
                    dialog.dismiss();
                    Toast.makeText(getContext(), "登入成功！歡迎 " + result.getName(), Toast.LENGTH_SHORT).show();
                    updateUserUI(result);
                }

                @Override
                public void onError(String error) {
                    if (!isAdded()) return;
                    positive.setEnabled(true);
                    Toast.makeText(getContext(), error, Toast.LENGTH_LONG).show();
                    etPassword.setText("");
                    loadCaptcha.run(); // captchas are single-use
                }
            });
        }));
        dialog.show();
        loadCaptcha.run();
    }
}
