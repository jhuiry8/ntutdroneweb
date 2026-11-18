"""Field layout of the six paper forms, mirroring normalizeFormData() in src/forms.js.

Each field is (key, label, kind, options). Kinds:
  text:N    single line, at most N characters      memo:N   multi-line text
  date      YYYY-MM-DD                             time     HH:MM
  int       integer (options = (min, max))         bool     check box
  enum      drop-down (options = [(value, label)]) multi    check boxes (options = [labels])
  lines     one item per line (公文「說明」)          items    table (options = (columns, max rows))
Fields marked required=True must be filled before saving (the server checks again).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

FORM_TYPES = [
    ("expense-request", "社費支出事前申請單"),
    ("expense-report", "社費事後報銷單"),
    ("equipment-loan", "設備借據"),
    ("activity-application", "學生活動申請表"),
    ("activity-report", "學生活動報告表"),
    ("official-letter", "公文"),
]
FORM_LABELS = dict(FORM_TYPES)

EXPENSE_CATEGORIES = [("activity", "活動支出"), ("regular", "經常性支出"), ("consumable", "耗材支出"),
                      ("drone", "無人機購買（長久性使用）"), ("other", "其他")]
LOCATION_TYPES = [("campus", "校內"), ("offcampus", "校外"), ("online", "線上")]
LETTER_TYPES = [("函", "函"), ("簽", "簽"), ("公告", "公告")]
VIRTUES = ["尊重生命", "孝親尊長", "負責盡責", "誠實信用", "團隊合作", "自主自律", "主動積極", "謙虛有禮", "關懷行善", "賞識感恩"]
SDGS = ["愛護環境", "接納包容", "公平正義", "消除貧窮", "終止飢餓", "優質教育", "氣候關懷", "友善環境", "性別平等", "海洋保育"]


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    kind: str
    options: object = None
    required: bool = False
    group: str = ""


def F(key, label, kind, options=None, required=False, group=""):  # noqa: N802 - short constructor
    return Field(key, label, kind, options, required, group)


EXPENSE_ITEMS = ([("date", "購買日", "date"), ("name", "物品名稱／規格", "text:100"), ("quantity", "數量", "int"),
                  ("unitPrice", "單價", "int"), ("note", "用途備註", "text:100")], 15)
LOAN_ITEMS = ([("name", "設備名稱／型號", "text:100"), ("assetNo", "財產編號", "text:40"), ("quantity", "數量", "int"),
               ("accessories", "配件", "text:100"), ("condition", "借出狀況", "text:50")], 6)

ACTIVITY_COMMON = [
    F("academicYear", "學年度", "int", (100, 200), True, "活動資料"),
    F("semester", "學期", "enum", [(1, "第一學期"), (2, "第二學期")], True, "活動資料"),
    F("title", "活動名稱", "text:100", required=True, group="活動資料"),
    F("startDate", "開始日期", "date", required=True, group="活動資料"),
    F("startTime", "開始時間", "time", group="活動資料"),
    F("endDate", "結束日期", "date", group="活動資料"),
    F("endTime", "結束時間", "time", group="活動資料"),
    F("locationType", "地點類型", "enum", LOCATION_TYPES, True, "活動資料"),
    F("location", "活動地點", "text:100", group="活動資料"),
    F("genderIssue", "涉及違反性別平等", "bool", group="議題"),
    F("virtues", "品德教育核心價值", "multi", VIRTUES, group="議題"),
    F("sdg", "永續發展目標", "enum", [("", "（無）")] + [(s, s) for s in SDGS], group="議題"),
]

SCHEMAS: dict[str, list[Field]] = {
    "expense-request": [
        F("applicant", "申請人", "text:50", required=True, group="申請人"),
        F("studentId", "學號", "text:30", group="申請人"),
        F("department", "系級", "text:50", group="申請人"),
        F("position", "社團職稱", "text:50", group="申請人"),
        F("applyDate", "申請日期", "date", required=True, group="申請人"),
        F("category", "支出類別", "enum", EXPENSE_CATEGORIES, True, "支出"),
        F("categoryOther", "其他類別說明", "text:50", group="支出"),
        F("items", "支出明細", "items", EXPENSE_ITEMS, True, "支出"),
    ],
    "expense-report": [
        F("applicant", "報銷人", "text:50", required=True, group="報銷人"),
        F("studentId", "學號", "text:30", group="報銷人"),
        F("department", "系級", "text:50", group="報銷人"),
        F("position", "社團職稱", "text:50", group="報銷人"),
        F("reportDate", "報銷日期", "date", required=True, group="報銷人"),
        F("originalApplyDate", "原申請日期", "date", group="報銷人"),
        F("requestNumber", "原申請單號", "text:30", group="報銷人"),
        F("category", "支出類別", "enum", EXPENSE_CATEGORIES, True, "支出"),
        F("categoryOther", "其他類別說明", "text:50", group="支出"),
        F("items", "支出明細", "items", EXPENSE_ITEMS, True, "支出"),
    ],
    "equipment-loan": [
        F("borrower", "借用人姓名", "text:50", required=True, group="借用人"),
        F("studentId", "學號", "text:30", group="借用人"),
        F("department", "系級", "text:50", group="借用人"),
        F("phone", "聯絡電話", "text:30", group="借用人"),
        F("purpose", "借用用途", "text:200", required=True, group="借用人"),
        F("fillDate", "填寫日期", "date", required=True, group="借用期間"),
        F("startDate", "借用起日", "date", required=True, group="借用期間"),
        F("startHour", "起始時（0-23）", "int", (0, 23), group="借用期間"),
        F("endDate", "歸還日", "date", required=True, group="借用期間"),
        F("endHour", "歸還時（0-23）", "int", (0, 23), group="借用期間"),
        F("items", "借用設備", "items", LOAN_ITEMS, True, "設備"),
    ],
    "activity-application": ACTIVITY_COMMON + [
        F("venueBooked", "已完成場地申請", "bool", group="檢核"),
        F("insured", "已辦理保險", "bool", group="檢核"),
        F("safetyReported", "已完成校外安全網通報", "bool", group="檢核"),
        F("content", "活動內容（流程）", "memo:3000", required=True, group="內容與人數"),
        F("internalCount", "本校參與人數", "int", (0, 100000), group="內容與人數"),
        F("externalCount", "他校參與人數", "int", (0, 100000), group="內容與人數"),
        F("totalCount", "活動總人數", "int", (0, 100000), group="內容與人數"),
        F("budgetTotal", "總預算", "int", (0, 100000000), group="經費"),
        F("budgetSelf", "自籌", "int", (0, 100000000), group="經費"),
        F("budgetSchool", "學校撥付", "int", (0, 100000000), group="經費"),
        F("budgetSponsor", "校外贊助", "int", (0, 100000000), group="經費"),
        F("contactName", "負責同學", "text:50", required=True, group="聯絡人"),
        F("contactClass", "班級", "text:50", group="聯絡人"),
        F("contactPhone", "聯絡電話", "text:30", group="聯絡人"),
    ],
    "activity-report": ACTIVITY_COMMON + [
        F("applicationNumber", "活動申請表編號", "text:30", group="活動資料"),
        F("totalCount", "參與總人數", "int", (0, 100000), group="人數"),
        F("internalMale", "本校男生", "int", (0, 100000), group="人數"),
        F("internalFemale", "本校女生", "int", (0, 100000), group="人數"),
        F("externalMale", "他校男生", "int", (0, 100000), group="人數"),
        F("externalFemale", "他校女生", "int", (0, 100000), group="人數"),
        F("process", "活動過程", "memo:3000", required=True, group="過程與經費"),
        F("spentTotal", "總經費", "int", (0, 100000000), group="過程與經費"),
        F("spentSelf", "自籌", "int", (0, 100000000), group="過程與經費"),
        F("spentSchool", "學校撥付", "int", (0, 100000000), group="過程與經費"),
        F("spentSponsor", "校外贊助", "int", (0, 100000000), group="過程與經費"),
        F("reviewStaff", "人員任務分配", "memo:300", group="檢討"),
        F("reviewVenue", "場地配合", "memo:300", group="檢討"),
        F("reviewParticipation", "人員參與", "memo:300", group="檢討"),
        F("reviewFunding", "經費來源", "memo:300", group="檢討"),
        F("improved", "以往缺失已改進", "enum", [("", "（未填）"), ("yes", "是"), ("no", "否")], group="檢討"),
        F("reviewOther", "其他", "memo:300", group="檢討"),
    ],
    "official-letter": [
        F("docType", "公文類型", "enum", LETTER_TYPES, True, "公文"),
        F("date", "發文日期", "date", required=True, group="公文"),
        F("recipient", "受文者", "text:100", group="公文"),
        F("copyTo", "副本", "text:200", group="公文"),
        F("subject", "主旨", "memo:500", required=True, group="公文"),
        F("descriptions", "說明（每行一點）", "lines", group="公文"),
    ],
}


def roc_academic_term(today: date | None = None) -> tuple[int, int]:
    """(學年度, 學期) in ROC years; the academic year starts in August."""
    today = today or date.today()
    if today.month >= 8:
        return today.year - 1911, 1
    return today.year - 1912, 1 if today.month == 1 else 2


def defaults(form_type: str, today: date | None = None) -> dict:
    """Sensible starting values for a new form."""
    today = today or date.today()
    iso = today.isoformat()
    year, term = roc_academic_term(today)
    values = {
        "expense-request": {"applyDate": iso, "category": "activity"},
        "expense-report": {"reportDate": iso, "category": "activity"},
        "equipment-loan": {"fillDate": iso, "startDate": iso, "endDate": iso},
        "activity-application": {"academicYear": year, "semester": term, "startDate": iso, "locationType": "campus"},
        "activity-report": {"academicYear": year, "semester": term, "startDate": iso, "locationType": "campus"},
        "official-letter": {"docType": "函", "date": iso},
    }
    return dict(values.get(form_type, {}))


def items_total(items: list) -> int:
    return sum((item.get("quantity") or 0) * (item.get("unitPrice") or 0) for item in items or [])
