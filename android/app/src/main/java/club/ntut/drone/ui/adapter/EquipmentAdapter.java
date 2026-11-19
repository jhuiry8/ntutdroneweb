package club.ntut.drone.ui.adapter;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

import club.ntut.drone.R;
import club.ntut.drone.model.Equipment;

public class EquipmentAdapter extends RecyclerView.Adapter<EquipmentAdapter.ViewHolder> {
    public interface OnBorrowClickListener {
        void onBorrowClick(Equipment item);
    }

    private final List<Equipment> items = new ArrayList<>();
    private final OnBorrowClickListener listener;

    public EquipmentAdapter(OnBorrowClickListener listener) {
        this.listener = listener;
    }

    public void setItems(List<Equipment> newItems) {
        this.items.clear();
        if (newItems != null) {
            this.items.addAll(newItems);
        }
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_equipment_card, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        Equipment item = items.get(position);
        holder.tvName.setText(item.getName());
        String location = item.getLocation().isEmpty() ? "" : " · 位置：" + item.getLocation();
        holder.tvCategory.setText("類別：" + item.getCategory() + location);

        if (item.isAvailable()) {
            holder.tvStatus.setText("可借用");
            holder.tvStatus.setBackgroundResource(R.drawable.bg_badge_available);
            holder.btnBorrow.setEnabled(true);
            holder.btnBorrow.setText("線上借用表單");
        } else if ("in_use".equalsIgnoreCase(item.getStatus())) {
            holder.tvStatus.setText("出借中");
            holder.tvStatus.setBackgroundResource(R.drawable.bg_badge_in_use);
            holder.btnBorrow.setEnabled(false);
            holder.btnBorrow.setText("已出借");
        } else if ("retired".equalsIgnoreCase(item.getStatus())) {
            holder.tvStatus.setText("已報廢");
            holder.tvStatus.setBackgroundResource(R.drawable.bg_badge_maintenance);
            holder.btnBorrow.setEnabled(false);
            holder.btnBorrow.setText("不可借用");
        } else {
            holder.tvStatus.setText("維修中");
            holder.tvStatus.setBackgroundResource(R.drawable.bg_badge_maintenance);
            holder.btnBorrow.setEnabled(false);
            holder.btnBorrow.setText("暫停借用");
        }

        holder.btnBorrow.setOnClickListener(v -> {
            if (listener != null) {
                listener.onBorrowClick(item);
            }
        });
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        TextView tvName;
        TextView tvCategory;
        TextView tvStatus;
        Button btnBorrow;

        ViewHolder(View itemView) {
            super(itemView);
            tvName = itemView.findViewById(R.id.tv_eq_name);
            tvCategory = itemView.findViewById(R.id.tv_eq_category);
            tvStatus = itemView.findViewById(R.id.tv_eq_status);
            btnBorrow = itemView.findViewById(R.id.btn_eq_borrow);
        }
    }
}
