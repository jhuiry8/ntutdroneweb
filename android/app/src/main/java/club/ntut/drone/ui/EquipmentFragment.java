package club.ntut.drone.ui;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ProgressBar;
import android.widget.TextView;

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

/**
 * Equipment inventory (officers only on the server). Borrowing always goes through the
 * public web form, which needs a CAPTCHA and the full multi-item loan schema.
 */
public class EquipmentFragment extends Fragment implements EquipmentAdapter.OnBorrowClickListener {
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private TextView tvEmpty;
    private EquipmentAdapter adapter;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_equipment, container, false);

        swipeRefresh = view.findViewById(R.id.swipe_refresh_equipment);
        RecyclerView recyclerView = view.findViewById(R.id.recycler_equipment);
        progressBar = view.findViewById(R.id.progress_equipment);
        tvEmpty = view.findViewById(R.id.tv_equipment_empty);
        tvEmpty.setOnClickListener(v -> openLoanForm());

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
                tvEmpty.setText("目前沒有列管設備\n\n點此開啟線上借用表單");
                tvEmpty.setVisibility(result.isEmpty() ? View.VISIBLE : View.GONE);
            }

            @Override
            public void onError(String error) {
                if (!isAdded()) return;
                progressBar.setVisibility(View.GONE);
                swipeRefresh.setRefreshing(false);
                adapter.setItems(null);
                tvEmpty.setText(error + "\n\n點此開啟線上借用表單");
                tvEmpty.setVisibility(View.VISIBLE);
            }
        });
    }

    private void openLoanForm() {
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(ApiClient.LOAN_FORM_URL)));
    }

    @Override
    public void onBorrowClick(Equipment item) {
        openLoanForm();
    }
}
