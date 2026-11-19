package club.ntut.drone.ui.adapter;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

import club.ntut.drone.R;
import club.ntut.drone.model.Post;

public class PostAdapter extends RecyclerView.Adapter<PostAdapter.ViewHolder> {
    private final List<Post> items = new ArrayList<>();

    public void setItems(List<Post> newItems) {
        this.items.clear();
        if (newItems != null) {
            this.items.addAll(newItems);
        }
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_post_card, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        Post item = items.get(position);
        holder.tvTag.setText(item.getTag());
        holder.tvDate.setText(item.getDate());
        holder.tvTitle.setText(item.getTitle());
        holder.tvExcerpt.setText(item.getExcerpt());
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        TextView tvTag;
        TextView tvDate;
        TextView tvTitle;
        TextView tvExcerpt;

        ViewHolder(View itemView) {
            super(itemView);
            tvTag = itemView.findViewById(R.id.tv_item_tag);
            tvDate = itemView.findViewById(R.id.tv_item_date);
            tvTitle = itemView.findViewById(R.id.tv_item_title);
            tvExcerpt = itemView.findViewById(R.id.tv_item_excerpt);
        }
    }
}
