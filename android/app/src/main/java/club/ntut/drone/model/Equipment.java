package club.ntut.drone.model;

/** An asset from /api/equipment (status: storage | in_use | repair | retired). */
public class Equipment {
    private final String id;
    private final String name;
    private final String category;
    private final String status;
    private final String location;

    public Equipment(String id, String name, String category, String status, String location) {
        this.id = id;
        this.name = name;
        this.category = category;
        this.status = status;
        this.location = location;
    }

    public String getId() { return id != null ? id : ""; }
    public String getName() { return name != null && !name.isEmpty() ? name : "未命名設備"; }
    public String getCategory() { return category != null && !category.isEmpty() ? category : "未分類"; }
    public String getStatus() { return status != null ? status : "storage"; }
    public String getLocation() { return location != null ? location : ""; }

    public boolean isAvailable() { return "storage".equals(getStatus()); }
}
