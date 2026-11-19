package club.ntut.drone.model;

public class User {
    private final String username;
    private final String role;
    private final String name;

    public User(String username, String role, String name) {
        this.username = username;
        this.role = role;
        this.name = name;
    }

    public static User guest() { return new User("", "guest", "訪客"); }

    public String getUsername() { return username != null ? username : ""; }
    public String getRole() { return role != null ? role : "guest"; }
    public String getName() { return name != null && !name.isEmpty() ? name : getUsername(); }

    public String getRoleLabel() {
        if ("president".equalsIgnoreCase(role)) return "社長";
        if ("finance".equalsIgnoreCase(role)) return "財務幹部";
        if ("cadre".equalsIgnoreCase(role)) return "社團幹部";
        if ("member".equalsIgnoreCase(role)) return "正式社員";
        return "訪客";
    }
}
