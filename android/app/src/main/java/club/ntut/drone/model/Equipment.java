package club.ntut.drone.model;

public class Equipment {
    private String id;
    private String name;
    private String category;
    private String status;

    public Equipment(String id, String name, String category, String status) {
        this.id = id;
        this.name = name;
        this.category = category;
        this.status = status;
    }

    public String getId() { return id != null ? id : ""; }
    public String getName() { return name != null ? name : ""; }
    public String getCategory() { return category != null ? category : "一般設備"; }
    public String getStatus() { return status != null ? status : "available"; }

    public boolean isAvailable() {
        return "available".equalsIgnoreCase(status) || "idle".equalsIgnoreCase(status);
    }
}
