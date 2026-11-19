package club.ntut.drone.ui.adapter;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

import club.ntut.drone.R;
import club.ntut.drone.model.Meeting;

public class MeetingAdapter extends RecyclerView.Adapter<MeetingAdapter.ViewHolder> {
    public interface OnCheckinClickListener {
        void onCheckinClick(Meeting item);
    }

    private final List<Meeting> items = new ArrayList<>();
    private final OnCheckinClickListener listener;

    public MeetingAdapter(OnCheckinClickListener listener) {
        this.listener = listener;
    }

    public void setItems(List<Meeting> newItems) {
        this.items.clear();
        if (newItems != null) {
            this.items.addAll(newItems);
        }
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_meeting_card, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        Meeting item = items.get(position);
        holder.tvTitle.setText(item.getTitle());
        String type = item.getTypeLabel().isEmpty() ? "" : item.getTypeLabel() + " · ";
        holder.tvDate.setText(type + item.getDate() + " · " + item.getStatusLabel());
        if (item.isCheckedIn()) {
            holder.btnCheckin.setEnabled(false);
            holder.btnCheckin.setText("已簽到");
        } else if (item.canCheckIn()) {
            holder.btnCheckin.setEnabled(true);
            holder.btnCheckin.setText("會議簽到");
        } else {
            holder.btnCheckin.setEnabled(false);
            holder.btnCheckin.setText("closed".equals(item.getStatus()) ? "已散會" : "尚未開放簽到");
        }

        holder.btnCheckin.setOnClickListener(v -> {
            if (listener != null) {
                listener.onCheckinClick(item);
            }
        });
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        TextView tvTitle;
        TextView tvDate;
        Button btnCheckin;

        ViewHolder(View itemView) {
            super(itemView);
            tvTitle = itemView.findViewById(R.id.tv_meeting_title);
            tvDate = itemView.findViewById(R.id.tv_meeting_date);
            btnCheckin = itemView.findViewById(R.id.btn_meeting_checkin);
        }
    }
}
