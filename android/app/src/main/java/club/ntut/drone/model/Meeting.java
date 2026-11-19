package club.ntut.drone.model;

/** A meeting from /api/meetings (status: draft | announced | open | closed ...). */
public class Meeting {
    private final String id;
    private final String title;
    private final String date;
    private final String status;
    private final String statusLabel;
    private final String typeLabel;
    private final boolean checkedIn;
    private final boolean requiresCode;

    public Meeting(String id, String title, String date, String status, String statusLabel,
                   String typeLabel, boolean checkedIn, boolean requiresCode) {
        this.id = id;
        this.title = title;
        this.date = date;
        this.status = status;
        this.statusLabel = statusLabel;
        this.typeLabel = typeLabel;
        this.checkedIn = checkedIn;
        this.requiresCode = requiresCode;
    }

    public String getId() { return id != null ? id : ""; }
    public String getTitle() { return title != null ? title : ""; }
    public String getDate() { return date != null ? date : ""; }
    public String getStatus() { return status != null ? status : ""; }
    public String getStatusLabel() { return statusLabel != null && !statusLabel.isEmpty() ? statusLabel : getStatus(); }
    public String getTypeLabel() { return typeLabel != null ? typeLabel : ""; }
    public boolean isCheckedIn() { return checkedIn; }
    public boolean requiresCode() { return requiresCode; }

    /** The server only accepts self check-in while the meeting is open. */
    public boolean canCheckIn() { return "open".equals(status) && !checkedIn; }
}
