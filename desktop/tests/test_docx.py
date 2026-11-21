"""Tests for the built-in Word writer. No Qt or server needed.

Run from the desktop/ folder:  python -m unittest discover -s tests
"""

import os
import sys
import tempfile
import unittest
import zipfile
from xml.dom import minidom

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from clubdesk.docx import Document, column_widths, export_table, inline_runs  # noqa: E402

try:
    import docx as python_docx  # optional: only used to double-check the files open in a real reader
except ImportError:  # pragma: no cover - not installed in the packaged program
    python_docx = None


class DocxTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()

    def path(self, name):
        return os.path.join(self.folder, name)

    def test_package_parts_are_well_formed_xml(self):
        doc = Document("測試", landscape=True)
        doc.title_block("社員名冊", "匯出時間 2026-11-19")
        doc.table(["學號", "姓名", "備註"], [["111360001", "王小明", "<b>&\"'"], ["", "", ""]])
        doc.save(self.path("a.docx"))
        with zipfile.ZipFile(self.path("a.docx")) as archive:
            names = set(archive.namelist())
            for part in ("[Content_Types].xml", "word/document.xml", "word/styles.xml", "word/numbering.xml",
                         "word/footer1.xml", "docProps/core.xml", "_rels/.rels", "word/_rels/document.xml.rels"):
                self.assertIn(part, names)
            for name in names:
                minidom.parseString(archive.read(name))  # raises on malformed XML
            body = archive.read("word/document.xml").decode("utf-8")
        self.assertIn('w:orient="landscape"', body)
        self.assertIn("&lt;b&gt;&amp;", body)
        self.assertIn("<w:tblHeader/>", body)  # header row repeats on every page

    def test_control_characters_are_dropped(self):
        doc = Document("x")
        doc.paragraph("bad\x00\x07text")
        doc.save(self.path("b.docx"))
        with zipfile.ZipFile(self.path("b.docx")) as archive:
            body = archive.read("word/document.xml").decode("utf-8")
        self.assertIn("badtext", body)

    def test_inline_markdown(self):
        runs = inline_runs("**粗體** 與 *斜體*、~~刪除~~、`code` 和 [網站](https://ntut.tpe.pp.ua)")
        self.assertIn("<w:b/>", runs)
        self.assertIn("<w:i/>", runs)
        self.assertIn("<w:strike/>", runs)
        self.assertIn("Consolas", runs)
        self.assertIn("https://ntut.tpe.pp.ua", runs)
        self.assertNotIn("**", runs)

    def test_markdown_blocks(self):
        doc = Document("文章")
        doc.markdown("# 標題\n\n段落一\n第二行\n\n- 項目一\n  - 子項目\n- [x] 已完成\n\n1. 第一\n2. 第二\n\n> 引用\n\n"
                     "```\ncode()\n```\n\n| 項目 | 金額 |\n| --- | --- |\n| 電池 | 3,000 |\n\n---\n\n![空拍](https://example.com/a.jpg)")
        doc.save(self.path("c.docx"))
        with zipfile.ZipFile(self.path("c.docx")) as archive:
            body = archive.read("word/document.xml").decode("utf-8")
            numbering = archive.read("word/numbering.xml").decode("utf-8")
        self.assertIn('w:val="Heading1"', body)
        self.assertIn("段落一 第二行", body)
        self.assertIn('<w:ilvl w:val="1"/>', body)  # nested list item
        self.assertIn("☑ 已完成", body)
        self.assertIn('w:val="Quote"', body)
        self.assertIn('w:val="Code"', body)
        self.assertIn("<w:tbl>", body)
        self.assertIn("［圖片：空拍］", body)
        self.assertIn('w:numId="101"', numbering)  # each numbered list restarts at 1

    def test_markdown_from_server_is_not_translated_in_english_mode(self):
        from clubdesk import i18n

        previous = i18n.language()
        i18n.set_language("en")
        try:
            program_text = i18n.tr("會議紀錄")
            self.assertNotEqual(program_text, "會議紀錄")  # program text is translated ...
            doc = Document("x")
            doc.markdown("# 會議紀錄\n\n會議紀錄 與 簽到\n\n| 會議紀錄 | 簽到 |\n| --- | --- |\n| 會議紀錄 | 簽到 |")
            doc.paragraph("會議紀錄")
            doc.save(self.path("en.docx"))
        finally:
            i18n.set_language(previous)
        with zipfile.ZipFile(self.path("en.docx")) as archive:
            body = archive.read("word/document.xml").decode("utf-8")
        self.assertEqual(body.count("會議紀錄"), 4)  # ... but the 4 server strings from markdown() stay Chinese
        self.assertIn(program_text, body)  # the direct paragraph() call was still translated

    def test_column_widths_fill_the_page_and_favour_long_columns(self):
        widths = column_widths(["學號", "姓名", "備註"], [["111360001", "王小明", "很長很長很長很長很長很長的備註"]], 3, 9600)
        self.assertLessEqual(sum(widths), 9600 + 3)
        self.assertGreater(widths[2], widths[1])

    def test_export_table_picks_landscape_for_wide_tables(self):
        export_table(self.path("d.docx"), "表", [f"欄{i}" for i in range(9)], [["x"] * 9])
        with zipfile.ZipFile(self.path("d.docx")) as archive:
            self.assertIn("landscape", archive.read("word/document.xml").decode("utf-8"))

    @unittest.skipIf(python_docx is None, "python-docx not installed")
    def test_opens_in_python_docx(self):
        doc = Document("社員名冊")
        doc.title_block("社員名冊", "副標")
        doc.markdown("## 小標\n\n- 一\n- 二")
        doc.table(["學號", "姓名"], [["1", "王小明"], ["2", "林小華"]])
        doc.save(self.path("e.docx"))
        opened = python_docx.Document(self.path("e.docx"))
        texts = [p.text for p in opened.paragraphs]
        self.assertIn("社員名冊", texts)
        self.assertIn("小標", texts)
        table = opened.tables[0]
        self.assertEqual([c.text for c in table.rows[1].cells], ["1", "王小明"])


if __name__ == "__main__":
    unittest.main()
