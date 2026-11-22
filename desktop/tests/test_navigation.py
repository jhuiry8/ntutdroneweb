"""Which pages the main window offers: permission codes from the server decide, the old role is the fallback."""

import os
import sys
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    from clubdesk.api import access_of
    from clubdesk.mainwindow import navigation
except ImportError as error:  # no Qt binding or its system libraries
    navigation = None
    SKIP = str(error)
else:
    SKIP = ""


def pages(user: dict) -> set:
    return {cls.__name__ for _, _, entries in navigation(access_of(user)) for cls, allowed in entries if allowed}


@unittest.skipIf(navigation is None, f"Qt unavailable: {SKIP}")
class NavigationTests(unittest.TestCase):
    def test_old_roles_without_permissions_see_what_they_always_saw(self):
        president = pages({"role": "president"})
        for name in ("UsersPage", "FinancePage", "MembersPage", "FeeReceiptsPage", "EquipmentPage", "NotesPage", "ReportsPage"):
            self.assertIn(name, president)
        cadre = pages({"role": "cadre"})
        self.assertIn("EquipmentPage", cadre)
        self.assertIn("NotesPage", cadre)
        self.assertNotIn("FinancePage", cadre)
        self.assertNotIn("MembersPage", cadre)
        self.assertNotIn("UsersPage", cadre)
        finance = pages({"role": "finance"})
        self.assertIn("FinancePage", finance)
        self.assertIn("MembersPage", finance)
        member = pages({"role": "member"})
        for name in ("PostsPage", "FinancePage", "MembersPage", "EquipmentPage", "NotesPage", "UsersPage", "ReportsPage"):
            self.assertNotIn(name, member)
        self.assertIn("AccountPage", member)

    def test_permissions_decide_when_the_server_sends_them(self):
        intern = pages({"role": "cadre", "permissions": ["classes.checkin", "equipment.view", "loans.draft"]})
        self.assertIn("EquipmentPage", intern)
        for name in ("PostsPage", "PagesPage", "HomepagePage", "FinancePage", "MembersPage", "FeeReceiptsPage", "NotesPage", "UsersPage", "ReportsPage"):
            self.assertNotIn(name, intern)
        treasurer = pages({"role": "finance", "permissions": ["cms.view", "finance.view", "finance.edit", "receipts.manage", "members.view"]})
        for name in ("FinancePage", "FeeReceiptsPage", "MembersPage"):
            self.assertIn(name, treasurer)
        self.assertNotIn("EquipmentPage", treasurer)
        self.assertNotIn("UsersPage", treasurer)
        committee = pages({"role": "cadre", "permissions": ["cms.view", "finance.view", "finance.audit"]})
        self.assertIn("FinancePage", committee)
        self.assertNotIn("MembersPage", committee)
        self.assertNotIn("EquipmentPage", committee)
        pr = pages({"role": "cadre", "permissions": ["cms.view", "cms.edit", "events.manage", "files.upload"]})
        for name in ("PostsPage", "PagesPage", "HomepagePage"):
            self.assertIn(name, pr)
        self.assertNotIn("FinancePage", pr)
        self.assertNotIn("EquipmentPage", pr)

    def test_a_president_role_without_permissions_is_not_trusted_when_the_list_is_empty(self):
        self.assertNotIn("UsersPage", pages({"role": "president", "permissions": []}))


if __name__ == "__main__":
    unittest.main()
