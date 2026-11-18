package club.ntut.drone;

import android.os.Bundle;

import androidx.appcompat.app.AppCompatActivity;
import androidx.fragment.app.Fragment;

import com.google.android.material.appbar.MaterialToolbar;
import com.google.android.material.bottomnavigation.BottomNavigationView;

import club.ntut.drone.ui.EquipmentFragment;
import club.ntut.drone.ui.HomeFragment;
import club.ntut.drone.ui.MeetingsFragment;
import club.ntut.drone.ui.NewsFragment;
import club.ntut.drone.ui.ProfileFragment;

public class MainActivity extends AppCompatActivity {
    private MaterialToolbar toolbar;
    private BottomNavigationView bottomNav;

    private final Fragment homeFragment = new HomeFragment();
    private final Fragment newsFragment = new NewsFragment();
    private final Fragment equipmentFragment = new EquipmentFragment();
    private final Fragment meetingsFragment = new MeetingsFragment();
    private final Fragment profileFragment = new ProfileFragment();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        toolbar = findViewById(R.id.toolbar);
        bottomNav = findViewById(R.id.bottom_nav);

        setSupportActionBar(toolbar);

        bottomNav.setOnItemSelectedListener(item -> {
            int itemId = item.getItemId();
            if (itemId == R.id.nav_home) {
                switchFragment(homeFragment, getString(R.string.nav_home));
                return true;
            } else if (itemId == R.id.nav_news) {
                switchFragment(newsFragment, getString(R.string.nav_news));
                return true;
            } else if (itemId == R.id.nav_equipment) {
                switchFragment(equipmentFragment, getString(R.string.nav_equipment));
                return true;
            } else if (itemId == R.id.nav_meetings) {
                switchFragment(meetingsFragment, getString(R.string.nav_meetings));
                return true;
            } else if (itemId == R.id.nav_profile) {
                switchFragment(profileFragment, getString(R.string.nav_profile));
                return true;
            }
            return false;
        });

        if (savedInstanceState == null) {
            switchFragment(homeFragment, getString(R.string.nav_home));
        }
    }

    private void switchFragment(Fragment fragment, String title) {
        getSupportFragmentManager()
                .beginTransaction()
                .replace(R.id.fragment_container, fragment)
                .commit();

        if (toolbar != null) {
            toolbar.setTitle(title.equals(getString(R.string.nav_home)) ? getString(R.string.app_name) : title);
        }
    }

    public void selectTab(int navId) {
        if (bottomNav != null) {
            bottomNav.setSelectedItemId(navId);
        }
    }
}
