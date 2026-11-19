"""English interface: every Chinese program text has a translation, and tr() keeps data intact."""

import ast
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from clubdesk import i18n  # noqa: E402
from clubdesk.translations_en import TRANSLATIONS  # noqa: E402

PACKAGE = os.path.join(os.path.dirname(__file__), "..", "clubdesk")
CJK = re.compile(r"[一-鿿]")
# Chinese constants that are code, not display text (the CJK regex in the editor).
NOT_DISPLAYED = {"[\u3400-\u9fff\uf900-\ufaff]"}
# Bilingual labels (\u200b + "Language / 語言") are written out on purpose and never translated.
# docx.py translates where it builds the document (tr in docx.py); icondata has no texts.
SKIP_FILES = {"docx.py", "icondata.py", "translations_en.py", "i18n.py"}


def program_texts():
    """Every Chinese string constant in the program (docstrings excluded) with its file."""
    found = {}
    for folder, _, files in os.walk(PACKAGE):
        for name in files:
            if not name.endswith(".py") or name in SKIP_FILES:
                continue
            path = os.path.join(folder, name)
            tree = ast.parse(open(path, encoding="utf-8").read())
            docstrings = {id(n.body[0].value) for n in ast.walk(tree)
                          if isinstance(n, (ast.Module, ast.ClassDef, ast.FunctionDef)) and n.body
                          and isinstance(n.body[0], ast.Expr) and isinstance(getattr(n.body[0], "value", None), ast.Constant)}
            for node in ast.walk(tree):
                if (isinstance(node, ast.Constant) and isinstance(node.value, str) and CJK.search(node.value)
                        and id(node) not in docstrings):
                    found.setdefault(node.value, os.path.relpath(path, PACKAGE))
    return found


class TranslationTableTests(unittest.TestCase):
    def test_every_program_text_is_translated(self):
        missing = {text: file for text, file in program_texts().items()
                   if text not in TRANSLATIONS and text not in NOT_DISPLAYED and not text.startswith("\u200b")}
        self.assertFalse(missing, "Add these to clubdesk/translations_en.py:\n" + "\n".join(
            f"{file}: {text[:70]!r}" for text, file in sorted(missing.items(), key=lambda x: x[1])))

    def test_translations_have_no_chinese_left(self):
        # A few entries keep Chinese on purpose: CSV column names the importers expect, shown with a gloss.
        for key, value in TRANSLATIONS.items():
            if CJK.search(value):
                self.assertIn("(", value, f"untranslated: {key[:40]!r}")


class TranslateTests(unittest.TestCase):
    def setUp(self):
        i18n.set_language("en")

    def tearDown(self):
        i18n.set_language("zh")

    def test_whole_text(self):
        self.assertEqual(i18n.tr("儲存"), TRANSLATIONS["儲存"])
        self.assertEqual(i18n.tr("新增(&N)..."), "&New...")

    def test_text_built_from_pieces(self):
        self.assertEqual(i18n.tr("社員 12 人，未繳社費 3 人"), "Members: 12, fees unpaid: 3")
        self.assertEqual(i18n.tr("第 2 案　王小明"), "Item 2: 王小明")

    def test_other_text_is_untouched(self):
        self.assertEqual(i18n.tr("Hello"), "Hello")
        self.assertEqual(i18n.tr("王小明"), "王小明")
        self.assertEqual(i18n.tr(""), "")
        self.assertIsNone(i18n.tr(None))

    def test_exact_only_leaves_data_alone(self):
        self.assertEqual(i18n.tr_exact("社員王小明"), "社員王小明")
        self.assertEqual(i18n.tr_exact("社員"), "Member")

    def test_marked_text_is_kept(self):
        self.assertEqual(i18n.tr("​繁體中文"), "​繁體中文")

    def test_server_data_marked_with_raw_is_kept(self):
        text = "會議紀錄：" + i18n.raw("新增設備，設定：完成") + "（已編輯）"
        self.assertEqual(i18n.tr(text), "Minutes: 新增設備，設定：完成 (edited)")
        self.assertNotIn("\ue000", i18n.tr(i18n.raw("王小明")))
        self.assertEqual(i18n.tr(i18n.raw("新增")), "新增")

    def test_raw_does_nothing_in_chinese(self):
        i18n.set_language("zh")
        self.assertEqual(i18n.raw("新增"), "新增")

    def test_chinese_mode_changes_nothing(self):
        i18n.set_language("zh")
        self.assertEqual(i18n.tr("儲存"), "儲存")


if __name__ == "__main__":
    unittest.main()
