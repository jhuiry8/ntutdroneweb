package club.ntut.drone.model;

public class Post {
    private String id;
    private String title;
    private String excerpt;
    private String date;
    private String tag;

    public Post(String id, String title, String excerpt, String date, String tag) {
        this.id = id;
        this.title = title;
        this.excerpt = excerpt;
        this.date = date;
        this.tag = tag;
    }

    public String getId() { return id != null ? id : ""; }
    public String getTitle() { return title != null ? title : ""; }
    public String getExcerpt() { return excerpt != null ? excerpt : ""; }
    public String getDate() { return date != null ? date : ""; }
    public String getTag() { return tag != null ? tag : "公告"; }
}
