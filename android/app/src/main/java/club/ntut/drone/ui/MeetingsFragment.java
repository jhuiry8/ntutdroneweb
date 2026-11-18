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
    private RecyclerView recyclerView;
    private ProgressBar progressBar;
    private TextView tvEmpty;
    private MeetingAdapter adapter;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_meetings, container, false);

        swipeRefresh = view.findViewById(R.id.swipe_refresh_meetings);
        recyclerView = view.findViewById(R.id.recycler_meetings);
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
                tvEmpty.setVisibility(result.isEmpty() ? View.VISIBLE : View.GONE);
            }

            @Override
            public void onError(String error) {
                if (!isAdded()) return;
                progressBar.setVisibility(View.GONE);
                swipeRefresh.setRefreshing(false);
            }
        });
    }

    @Override
    public void onCheckinClick(Meeting item) {
        if (getContext() == null) return;

        View dialogView = LayoutInflater.from(getContext()).inflate(R.layout.dialog_checkin, null);
        TextView tvTitle = dialogView.findViewById(R.id.tv_dialog_checkin_title);
        EditText etStudentId = dialogView.findViewById(R.id.et_checkin_student_id);
        EditText etName = dialogView.findViewById(R.id.et_checkin_name);

        tvTitle.setText("會議簽到：" + item.getTitle());

        new AlertDialog.Builder(getContext(), android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setView(dialogView)
                .setPositiveButton("送出簽到", (dialog, which) -> {
                    String studentId = etStudentId.getText().toString().trim();
                    String name = etName.getText().toString().trim();

                    if (studentId.isEmpty() || name.isEmpty()) {
                        Toast.makeText(getContext(), "請輸入完整學號與姓名", Toast.LENGTH_SHORT).show();
                        return;
                    }

                    ApiClient.getInstance(getContext()).submitCheckin(item.getId(), studentId, name, new ApiClient.ApiCallback<String>() {
                        @Override
                        public void onSuccess(String result) {
                            Toast.makeText(getContext(), result, Toast.LENGTH_LONG).show();
                        }

                        @Override
                        public void onError(String error) {
                            Toast.makeText(getContext(), "簽到失敗：" + error, Toast.LENGTH_SHORT).show();
                        }
                    });
                })
                .setNegativeButton("取消", null)
                .show();
    }
}
