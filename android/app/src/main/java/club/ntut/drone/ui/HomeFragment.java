package club.ntut.drone.ui;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import java.util.List;

import club.ntut.drone.MainActivity;
import club.ntut.drone.R;
import club.ntut.drone.api.ApiClient;
import club.ntut.drone.model.Post;

public class HomeFragment extends Fragment {
    private TextView tvAnnTitle;
    private TextView tvAnnDate;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_home, container, false);

        tvAnnTitle = view.findViewById(R.id.tv_home_ann_title);
        tvAnnDate = view.findViewById(R.id.tv_home_ann_date);

        // The loan form needs a CAPTCHA and the full item list, so it is filled on the website.
        view.findViewById(R.id.btn_home_loan).setOnClickListener(v ->
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(ApiClient.LOAN_FORM_URL))));

        view.findViewById(R.id.btn_home_checkin).setOnClickListener(v -> {
            if (getActivity() instanceof MainActivity) {
                ((MainActivity) getActivity()).selectTab(R.id.nav_meetings);
            }
        });

        view.findViewById(R.id.card_latest_announcement).setOnClickListener(v -> {
            if (getActivity() instanceof MainActivity) {
                ((MainActivity) getActivity()).selectTab(R.id.nav_news);
            }
        });

        view.findViewById(R.id.btn_home_line).setOnClickListener(v -> {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://lin.ee/s5YJgGI")));
        });

        view.findViewById(R.id.btn_home_ig).setOnClickListener(v -> {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.instagram.com/ntut_drone/")));
        });

        loadLatestAnnouncement();
        return view;
    }

    private void loadLatestAnnouncement() {
        if (getContext() == null) return;
        ApiClient.getInstance(getContext()).fetchAnnouncements(new ApiClient.ApiCallback<List<Post>>() {
            @Override
            public void onSuccess(List<Post> result) {
                if (!isAdded()) return;
                if (result.isEmpty()) {
                    tvAnnTitle.setText("目前沒有公告");
                    tvAnnDate.setText("點擊查看所有消息");
                    return;
                }
                Post p = result.get(0);
                tvAnnTitle.setText(p.getTitle());
                tvAnnDate.setText(p.getDate() + " · " + p.getTag());
            }

            @Override
            public void onError(String error) {
                if (!isAdded()) return;
                tvAnnTitle.setText(error);
                tvAnnDate.setText("點擊查看所有消息");
            }
        });
    }
}
