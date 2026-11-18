package club.ntut.drone.ui;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

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
            if (ApiClient.getInstance(getContext()).isLoggedIn()) {
                ApiClient.getInstance(getContext()).clearSession();
                updateUserUI(new User("guest", "guest", "訪客"));
                Toast.makeText(getContext(), "已登出", Toast.LENGTH_SHORT).show();
            } else {
                showLoginDialog();
            }
        });

        view.findViewById(R.id.btn_profile_line).setOnClickListener(v -> {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://lin.ee/s5YJgGI")));
        });

        view.findViewById(R.id.btn_profile_ig).setOnClickListener(v -> {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.instagram.com/ntut_drone/")));
        });

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
        ApiClient.getInstance(getContext()).fetchMe(new ApiClient.ApiCallback<User>() {
            @Override
            public void onSuccess(User result) {
                if (isAdded()) {
                    updateUserUI(result);
                }
            }

            @Override
            public void onError(String error) {
                if (isAdded()) {
                    updateUserUI(new User("guest", "guest", "訪客"));
                }
            }
        });
    }

    private void updateUserUI(User user) {
        tvName.setText(user.getName());
        tvRole.setText("社團身份：" + user.getRoleLabel());
        if (getContext() != null && ApiClient.getInstance(getContext()).isLoggedIn()) {
            btnAuth.setText("登出帳號");
        } else {
            btnAuth.setText("社員 / 幹部登入");
        }
    }

    private void showLoginDialog() {
        if (getContext() == null) return;

        View dialogView = LayoutInflater.from(getContext()).inflate(R.layout.dialog_login, null);
        EditText etUsername = dialogView.findViewById(R.id.et_login_username);
        EditText etPassword = dialogView.findViewById(R.id.et_login_password);

        new AlertDialog.Builder(getContext(), android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setView(dialogView)
                .setPositiveButton("登入", (dialog, which) -> {
                    String username = etUsername.getText().toString().trim();
                    String password = etPassword.getText().toString().trim();

                    if (username.isEmpty() || password.isEmpty()) {
                        Toast.makeText(getContext(), "請輸入帳號與密碼", Toast.LENGTH_SHORT).show();
                        return;
                    }

                    ApiClient.getInstance(getContext()).login(username, password, new ApiClient.ApiCallback<User>() {
                        @Override
                        public void onSuccess(User result) {
                            Toast.makeText(getContext(), "登入成功！歡迎 " + result.getName(), Toast.LENGTH_SHORT).show();
                            updateUserUI(result);
                        }

                        @Override
                        public void onError(String error) {
                            Toast.makeText(getContext(), error, Toast.LENGTH_LONG).show();
                        }
                    });
                })
                .setNegativeButton("取消", null)
                .show();
    }
}
