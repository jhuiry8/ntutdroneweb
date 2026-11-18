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
import club.ntut.drone.model.Equipment;
import club.ntut.drone.ui.adapter.EquipmentAdapter;

public class EquipmentFragment extends Fragment implements EquipmentAdapter.OnBorrowClickListener {
    private SwipeRefreshLayout swipeRefresh;
    private RecyclerView recyclerView;
    private ProgressBar progressBar;
    private TextView tvEmpty;
    private EquipmentAdapter adapter;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_equipment, container, false);

        swipeRefresh = view.findViewById(R.id.swipe_refresh_equipment);
        recyclerView = view.findViewById(R.id.recycler_equipment);
        progressBar = view.findViewById(R.id.progress_equipment);
        tvEmpty = view.findViewById(R.id.tv_equipment_empty);

        adapter = new EquipmentAdapter(this);
        recyclerView.setLayoutManager(new LinearLayoutManager(getContext()));
        recyclerView.setAdapter(adapter);

        swipeRefresh.setOnRefreshListener(this::loadEquipment);

        loadEquipment();
        return view;
    }

    private void loadEquipment() {
        if (getContext() == null) return;
        progressBar.setVisibility(View.VISIBLE);

        ApiClient.getInstance(getContext()).fetchEquipment(new ApiClient.ApiCallback<List<Equipment>>() {
            @Override
            public void onSuccess(List<Equipment> result) {
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
    public void onBorrowClick(Equipment item) {
        if (getContext() == null) return;

        View dialogView = LayoutInflater.from(getContext()).inflate(R.layout.dialog_loan, null);
        TextView tvTitle = dialogView.findViewById(R.id.tv_dialog_loan_title);
        EditText etStudentId = dialogView.findViewById(R.id.et_loan_student_id);
        EditText etName = dialogView.findViewById(R.id.et_loan_name);
        EditText etPhone = dialogView.findViewById(R.id.et_loan_phone);
        EditText etPurpose = dialogView.findViewById(R.id.et_loan_purpose);

        tvTitle.setText("申請借用：" + item.getName());

        new AlertDialog.Builder(getContext(), android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setView(dialogView)
                .setPositiveButton("確認送出", (dialog, which) -> {
                    String studentId = etStudentId.getText().toString().trim();
                    String name = etName.getText().toString().trim();
                    String phone = etPhone.getText().toString().trim();
                    String purpose = etPurpose.getText().toString().trim();

                    if (studentId.isEmpty() || name.isEmpty() || phone.isEmpty()) {
                        Toast.makeText(getContext(), "請填寫完整學號、姓名與電話", Toast.LENGTH_SHORT).show();
                        return;
                    }

                    ApiClient.getInstance(getContext()).submitLoan(studentId, name, phone, item.getName(), purpose, new ApiClient.ApiCallback<String>() {
                        @Override
                        public void onSuccess(String result) {
                            Toast.makeText(getContext(), result, Toast.LENGTH_LONG).show();
                        }

                        @Override
                        public void onError(String error) {
                            Toast.makeText(getContext(), "送出失敗：" + error, Toast.LENGTH_SHORT).show();
                        }
                    });
                })
                .setNegativeButton("取消", null)
                .show();
    }
}
