package club.ntut.drone.model;

public class Meeting {
    private String id;
    private String title;
    private String date;
    private String status;

    public Meeting(String id, String title, String date, String status) {
        this.id = id;
        this.title = title;
        this.date = date;
        this.status = status;
    }

    public String getId() { return id != null ? id : ""; }
    public String getTitle() { return title != null ? title : ""; }
    public String getDate() { return date != null ? date : ""; }
    public String getStatus() { return status != null ? status : "scheduled"; }
}
