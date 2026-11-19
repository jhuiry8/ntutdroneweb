package club.ntut.drone.ui;

import android.app.AlertDialog;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import java.util.List;

import club.ntut.drone.R;
import club.ntut.drone.api.ApiClient;
import club.ntut.drone.model.Meeting;
import club.ntut.drone.ui.adapter.MeetingAdapter;

public class MeetingsFragment extends Fragment implements MeetingAdapter.OnCheckinClickListener {
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private TextView tvEmpty;
    private MeetingAdapter adapter;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_meetings, container, false);

        swipeRefresh = view.findViewById(R.id.swipe_refresh_meetings);
        RecyclerView recyclerView = view.findViewById(R.id.recycler_meetings);
        progressBar = view.findViewById(R.id.progress_meetings);
        tvEmpty = view.findViewById(R.id.tv_meetings_empty);

        adapter = new MeetingAdapter(this);
        recyclerView.setLayoutManager(new LinearLayoutManager(getContext()));
        recyclerView.setAdapter(adapter);

        swipeRefresh.setOnRefreshListener(this::loadMeetings);

        loadMeetings();
        return view;
    }

    private void loadMeetings() {
        if (getContext() == null) return;
        progressBar.setVisibility(View.VISIBLE);

        ApiClient.getInstance(getContext()).fetchMeetings(new ApiClient.ApiCallback<List<Meeting>>() {
            @Override
            public void onSuccess(List<Meeting> result) {
                if (!isAdded()) return;
                progressBar.setVisibility(View.GONE);
                swipeRefresh.setRefreshing(false);
                adapter.setItems(result);
                tvEmpty.setText("目前沒有會議");
                tvEmpty.setVisibility(result.isEmpty() ? View.VISIBLE : View.GONE);
            }

            @Override
            public void onError(String error) {
                if (!isAdded()) return;
                progressBar.setVisibility(View.GONE);
                swipeRefresh.setRefreshing(false);
                adapter.setItems(null);
                tvEmpty.setText(error);
                tvEmpty.setVisibility(View.VISIBLE);
            }
        });
    }

    @Override
    public void onCheckinClick(Meeting item) {
        if (getContext() == null) return;
        if (!item.requiresCode()) {
            submitCheckin(item, "");
            return;
        }

        View dialogView = LayoutInflater.from(getContext()).inflate(R.layout.dialog_checkin, null);
        TextView tvTitle = dialogView.findViewById(R.id.tv_dialog_checkin_title);
        EditText etCode = dialogView.findViewById(R.id.et_checkin_code);
        tvTitle.setText("會議簽到：" + item.getTitle());

        new AlertDialog.Builder(getContext(), android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setView(dialogView)
                .setPositiveButton("送出簽到", (dialog, which) -> {
                    String code = etCode.getText().toString().trim();
                    if (code.isEmpty()) {
                        Toast.makeText(getContext(), "請輸入主席公布的簽到碼", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    submitCheckin(item, code);
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private void submitCheckin(Meeting item, String code) {
        if (getContext() == null) return;
        ApiClient.getInstance(getContext()).checkIn(item.getId(), code, new ApiClient.ApiCallback<String>() {
            @Override
            public void onSuccess(String result) {
                if (!isAdded()) return;
                Toast.makeText(getContext(), result, Toast.LENGTH_LONG).show();
                loadMeetings();
            }

            @Override
            public void onError(String error) {
                if (!isAdded()) return;
                Toast.makeText(getContext(), "簽到失敗：" + error, Toast.LENGTH_LONG).show();
            }
        });
    }
}
