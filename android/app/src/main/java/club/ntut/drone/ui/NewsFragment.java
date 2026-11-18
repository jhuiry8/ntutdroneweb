package club.ntut.drone.ui;

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
import club.ntut.drone.model.Post;
import club.ntut.drone.ui.adapter.PostAdapter;

public class NewsFragment extends Fragment {
    private SwipeRefreshLayout swipeRefresh;
    private RecyclerView recyclerView;
    private ProgressBar progressBar;
    private TextView tvEmpty;
    private PostAdapter adapter;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_news, container, false);

        swipeRefresh = view.findViewById(R.id.swipe_refresh_news);
        recyclerView = view.findViewById(R.id.recycler_news);
        progressBar = view.findViewById(R.id.progress_news);
        tvEmpty = view.findViewById(R.id.tv_news_empty);

        adapter = new PostAdapter();
        recyclerView.setLayoutManager(new LinearLayoutManager(getContext()));
        recyclerView.setAdapter(adapter);

        swipeRefresh.setOnRefreshListener(this::loadNews);

        loadNews();
        return view;
    }

    private void loadNews() {
        if (getContext() == null) return;
        progressBar.setVisibility(View.VISIBLE);

        ApiClient.getInstance(getContext()).fetchAnnouncements(new ApiClient.ApiCallback<List<Post>>() {
            @Override
            public void onSuccess(List<Post> result) {
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
}
