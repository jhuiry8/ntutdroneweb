"""Minimal Word (.docx) writer using only the standard library.

python-docx would pull in lxml (about 10 MB), so this module writes the few
parts Word needs by hand: headings, paragraphs with bold/italic/code runs,
bullet and numbered lists, block quotes, tables with a repeated shaded
header row, page orientation and a page-number footer. Chinese text uses
新細明體 (PMingLiU), Latin text Times New Roman, like a printed club document.

    doc = Document("社員名冊", landscape=True)
    doc.heading("社員名冊", 1)
    doc.paragraph("匯出時間：2026-11-19")
    doc.table(["學號", "姓名"], [["111360001", "王小明"]])
    doc.save("社員名冊.docx")
"""

from __future__ import annotations

import re
import zipfile
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from .i18n import is_english, tr, tr_exact

EAST_ASIA_FONT = "PMingLiU"
LATIN_FONT = "Times New Roman"
# Characters XML 1.0 forbids (control codes other than tab/newline/CR).
_INVALID_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]")


def _text(value) -> str:
    return escape(_INVALID_XML.sub("", "" if value is None else str(value)))


def _run(text: str, bold=False, italic=False, code=False, strike=False, size: int | None = None, colour: str = "") -> str:
    props = []
    if code:
        props.append('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="MingLiU"/>')
    if bold:
        props.append("<w:b/>")
    if italic:
        props.append("<w:i/>")
    if strike:
        props.append("<w:strike/>")
    if colour:
        props.append(f'<w:color w:val="{colour}"/>')
    if size:
        props.append(f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>')
    if code:
        props.append('<w:shd w:val="clear" w:color="auto" w:fill="F2F1EC"/>')
    rpr = f"<w:rPr>{''.join(props)}</w:rPr>" if props else ""
    # Line breaks inside one paragraph become <w:br/>.
    parts = str(text).split("\n")
    body = "<w:br/>".join(f'<w:t xml:space="preserve">{_text(part)}</w:t>' for part in parts)
    return f"<w:r>{rpr}{body}</w:r>"


_INLINE = re.compile(r"(\*\*(.+?)\*\*|~~(.+?)~~|`([^`]+)`|\[([^\]]+)\]\((https?://[^)\s]+)\)|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*]))")


def inline_runs(text: str, size: int | None = None) -> str:
    """Runs for one line of Markdown-style inline formatting: **bold**, *italic*, ~~strike~~, `code`, [link](url)."""
    runs, last = [], 0
    for match in _INLINE.finditer(text):
        if match.start() > last:
            runs.append(_run(text[last:match.start()], size=size))
        bold, strike, code, label, url, italic = match.group(2), match.group(3), match.group(4), match.group(5), match.group(6), match.group(7)
        if bold is not None:
            runs.append(_run(bold, bold=True, size=size))
        elif strike is not None:
            runs.append(_run(strike, strike=True, size=size))
        elif code is not None:
            runs.append(_run(code, code=True, size=size))
        elif label is not None:
            runs.append(_run(label, size=size, colour="0000FF") + _run(f"（{url}）", size=size, colour="808080"))
        else:
            runs.append(_run(italic, italic=True, size=size))
        last = match.end()
    if last < len(text):
        runs.append(_run(text[last:], size=size))
    return "".join(runs)


class Document:
    def __init__(self, title: str = "", landscape: bool = False, author: str = "北科無人機社 社務管理系統"):
        self.title = tr_exact(title)  # often a post / meeting title: whole-text matches only
        self.author = tr(author)
        self.landscape = landscape
        self.body: list[str] = []
        self.uses_numbering = False
        self._list_id = 0
        self._translate = True  # off while adding server Markdown, which must stay exactly as written

    def _tr(self, text, pieces: bool = True):
        return tr(text, pieces) if self._translate else text

    # ------------------------------------------------------------ blocks
    def _paragraph(self, runs: str, style: str = "", align: str = "", spacing_after: int | None = None,
                   indent: int = 0, numbering: tuple[int, int] | None = None, keep_next=False) -> None:
        props = []
        if style:
            props.append(f'<w:pStyle w:val="{style}"/>')
        if keep_next:
            props.append("<w:keepNext/>")
        if numbering:
            props.append(f'<w:numPr><w:ilvl w:val="{numbering[1]}"/><w:numId w:val="{numbering[0]}"/></w:numPr>')
        if spacing_after is not None:
            props.append(f'<w:spacing w:after="{spacing_after}"/>')
        if indent:
            props.append(f'<w:ind w:left="{indent}"/>')
        if align:
            props.append(f'<w:jc w:val="{align}"/>')
        ppr = f"<w:pPr>{''.join(props)}</w:pPr>" if props else ""
        self.body.append(f"<w:p>{ppr}{runs}</w:p>")

    def heading(self, text: str, level: int = 1) -> None:
        self._paragraph(inline_runs(self._tr(text)), style=f"Heading{min(max(level, 1), 3)}", keep_next=True)

    def title_block(self, title: str, subtitle: str = "") -> None:
        self._paragraph(_run(tr(title)), style="Title", align="center")
        if subtitle:
            self._paragraph(_run(tr(subtitle), size=18, colour="606060"), align="center", spacing_after=240)

    def paragraph(self, text: str = "", bold=False, align: str = "", size: int | None = None) -> None:
        text = self._tr(text)
        runs = _run(text, bold=True, size=size) if bold else inline_runs(text, size=size)
        self._paragraph(runs, align=align)

    def quote(self, text: str) -> None:
        self._paragraph(inline_runs(text), style="Quote")

    def code_block(self, text: str) -> None:
        for line in text.split("\n") or [""]:
            self._paragraph(_run(line or " ", code=True), style="Code")

    def bullets(self, items: list[str], ordered: bool = False) -> None:
        self.uses_numbering = True
        # Every numbered list restarts at 1, so it gets its own numbering instance.
        if ordered:
            self._list_id += 1
            num_id = 100 + self._list_id
        else:
            num_id = 1
        for item in items:
            level = 0
            while item.startswith("  "):
                item, level = item[2:], level + 1
            self._paragraph(inline_runs(item), style="ListParagraph", numbering=(num_id, min(level, 2)))

    def rule(self) -> None:
        self.body.append('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr></w:pPr></w:p>')

    def page_break(self) -> None:
        self.body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')

    def table(self, headers: list[str], rows: list[list], widths: list[int] | None = None,
              align_right: set[int] | None = None, font_size: int = 18) -> None:
        """A bordered table; the shaded header row repeats on every page."""
        align_right = align_right or set()
        headers = [self._tr(h) for h in headers]
        rows = [[self._tr(v, False) for v in row] for row in rows]
        columns = max(len(headers), max((len(r) for r in rows), default=0)) or 1
        usable = 14400 if self.landscape else 9600  # twips between margins
        if not widths:
            widths = column_widths(headers, rows, columns, usable)
        grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)

        def cell(value, width, header=False, right=False):
            shade = '<w:shd w:val="clear" w:color="auto" w:fill="D4D0C8"/>' if header else ""
            jc = '<w:jc w:val="center"/>' if header else ('<w:jc w:val="right"/>' if right else "")
            text = _run(value, bold=header, size=font_size)
            return (f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{shade}</w:tcPr>'
                    f'<w:p><w:pPr><w:spacing w:before="20" w:after="20"/>{jc}</w:pPr>{text}</w:p></w:tc>')

        out = ['<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>'
               '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar>'
               f'</w:tblPr><w:tblGrid>{grid}</w:tblGrid>']
        out.append('<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>'
                   + "".join(cell(h, widths[i], header=True) for i, h in enumerate(list(headers) + [""] * (columns - len(headers)))) + "</w:tr>")
        for row in rows:
            values = list(row) + [""] * (columns - len(row))
            out.append("<w:tr><w:trPr><w:cantSplit/></w:trPr>"
                       + "".join(cell(v, widths[i], right=i in align_right) for i, v in enumerate(values)) + "</w:tr>")
        out.append("</w:tbl>")
        self.body.append("".join(out))
        self._paragraph("", spacing_after=0)  # Word needs a paragraph after a table

    def markdown(self, text: str) -> None:
        """Adds Markdown content (posts, minutes, notices): headings, lists, quotes, tables, code, rules.

        The text comes from the server, so it is never run through tr(), even in English mode.
        """
        self._translate = False
        try:
            self._markdown(text)
        finally:
            self._translate = True

    def _markdown(self, text: str) -> None:
        lines = (text or "").replace("\r\n", "\n").split("\n")
        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()
            if not stripped:
                i += 1
                continue
            if stripped.startswith("```"):
                block = []
                i += 1
                while i < len(lines) and not lines[i].strip().startswith("```"):
                    block.append(lines[i])
                    i += 1
                self.code_block("\n".join(block))
                i += 1
                continue
            heading = re.match(r"^(#{1,6})\s+(.*)$", stripped)
            if heading:
                self.heading(heading.group(2).strip(), len(heading.group(1)))
                i += 1
                continue
            if re.match(r"^(-{3,}|\*{3,}|_{3,})$", stripped):
                self.rule()
                i += 1
                continue
            if stripped.startswith("|") and i + 1 < len(lines) and re.match(r"^\|?\s*:?-{2,}", lines[i + 1].strip()):
                header = split_row(stripped)
                i += 2
                rows = []
                while i < len(lines) and lines[i].strip().startswith("|"):
                    rows.append(split_row(lines[i].strip()))
                    i += 1
                self.table(header, rows)
                continue
            if stripped.startswith(">"):
                quote = []
                while i < len(lines) and lines[i].strip().startswith(">"):
                    quote.append(lines[i].strip()[1:].strip())
                    i += 1
                self.quote("\n".join(quote))
                continue
            listing = re.match(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$", line)
            if listing:
                ordered = listing.group(2)[0].isdigit()
                items = []
                while i < len(lines):
                    match = re.match(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$", lines[i])
                    if not match or match.group(2)[0].isdigit() != ordered:
                        break
                    content = re.sub(r"^\[( |x|X)\]\s+", lambda m: "☑ " if m.group(1).lower() == "x" else "☐ ", match.group(3))
                    items.append("  " * (len(match.group(1).expandtabs(4)) // 2) + content)
                    i += 1
                self.bullets(items, ordered)
                continue
            paragraph = [stripped]
            i += 1
            while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,6}\s|>|```|\||(\s*)([-*+]|\d+[.)])\s)", lines[i].strip()):
                paragraph.append(lines[i].strip())
                i += 1
            # Images become their description and address; Word cannot fetch them.
            joined = re.sub(r"!\[([^\]]*)\]\(([^)\s]+)\)", lambda m: f"［圖片：{m.group(1) or '未命名'}］{m.group(2)}", " ".join(paragraph))
            self.paragraph(joined)

    # ------------------------------------------------------------ output
    def save(self, path: str) -> None:
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("[Content_Types].xml", CONTENT_TYPES)
            archive.writestr("_rels/.rels", ROOT_RELS)
            archive.writestr("docProps/core.xml", self._core())
            archive.writestr("docProps/app.xml", APP)
            archive.writestr("word/_rels/document.xml.rels", DOCUMENT_RELS)
            archive.writestr("word/document.xml", self._document())
            archive.writestr("word/styles.xml", STYLES)
            archive.writestr("word/numbering.xml", self._numbering())
            archive.writestr("word/footer1.xml", _footer())
            archive.writestr("word/settings.xml", SETTINGS)

    def _document(self) -> str:
        width, height = (16838, 11906) if self.landscape else (11906, 16838)  # A4
        orient = ' w:orient="landscape"' if self.landscape else ""
        section = (f'<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/>'
                   f'<w:pgSz w:w="{width}" w:h="{height}"{orient}/>'
                   '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>'
                   "</w:sectPr>")
        return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document {NAMESPACES}>'
                f"<w:body>{''.join(self.body)}{section}</w:body></w:document>")

    def _core(self) -> str:
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
                'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
                'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
                f"<dc:title>{_text(self.title)}</dc:title><dc:creator>{_text(self.author)}</dc:creator>"
                f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>'
                f'<dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified></cp:coreProperties>')

    def _numbering(self) -> str:
        bullet = "".join(f'<w:lvl w:ilvl="{n}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="{c}"/>'
                         f'<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{480 + 480 * n}" w:hanging="240"/></w:pPr></w:lvl>'
                         for n, c in enumerate("●○■"))
        decimal = "".join(f'<w:lvl w:ilvl="{n}"><w:start w:val="1"/><w:numFmt w:val="{fmt}"/><w:lvlText w:val="%{n + 1}."/>'
                          f'<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{480 + 480 * n}" w:hanging="360"/></w:pPr></w:lvl>'
                          for n, fmt in enumerate(("decimal", "lowerLetter", "lowerRoman")))
        nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' + "".join(
            f'<w:num w:numId="{100 + n}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'
            for n in range(1, self._list_id + 1))
        return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering {NAMESPACES}>'
                f'<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>{bullet}</w:abstractNum>'
                f'<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>{decimal}</w:abstractNum>'
                f"{nums}</w:numbering>")


def split_row(line: str) -> list[str]:
    cells = line.strip().strip("|").split("|")
    return [cell.strip() for cell in cells]


def _display_width(text: str) -> int:
    """Rough printed width: CJK and full-width characters count double."""
    return sum(2 if ord(ch) > 0x2E7F else 1 for ch in str(text))


def column_widths(headers, rows, columns: int, usable: int) -> list[int]:
    sample = rows[:200]
    wants = []
    for c in range(columns):
        values = [headers[c] if c < len(headers) else ""] + [r[c] if c < len(r) else "" for r in sample]
        longest = max((_display_width(v) for v in values), default=4)
        wants.append(min(max(longest, 4), 40))
    total = sum(wants)
    return [max(500, int(usable * w / total)) for w in wants]


NAMESPACES = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
              'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""

DOCUMENT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>"""

APP = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ClubDesk</Application></Properties>"""

SETTINGS = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings {NAMESPACES}><w:defaultTabStop w:val="480"/><w:characterSpacingControl w:val="compressPunctuation"/>
<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>"""

FOOTER = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr {NAMESPACES}><w:p><w:pPr><w:jc w:val="center"/></w:pPr>
<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">第 </w:t></w:r>
<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>
<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>
<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r>
<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>
<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve"> 頁　北科無人機社</w:t></w:r></w:p></w:ftr>"""

_FONTS = f'<w:rFonts w:ascii="{LATIN_FONT}" w:hAnsi="{LATIN_FONT}" w:eastAsia="{EAST_ASIA_FONT}" w:cs="{LATIN_FONT}"/>'


def _heading_style(level: int, size: int) -> str:
    return (f'<w:style w:type="paragraph" w:styleId="Heading{level}"><w:name w:val="heading {level}"/>'
            '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
            f'<w:pPr><w:keepNext/><w:spacing w:before="{240 if level == 1 else 180}" w:after="120"/><w:outlineLvl w:val="{level - 1}"/></w:pPr>'
            f'<w:rPr><w:b/><w:color w:val="0A246A"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr></w:style>')


STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles {NAMESPACES}>
<w:docDefaults><w:rPrDefault><w:rPr>{_FONTS}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-TW"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
<w:pPr><w:spacing w:after="60"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
{_heading_style(1, 30)}{_heading_style(2, 26)}{_heading_style(3, 23)}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>
<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="A0A0A0"/></w:pBdr><w:ind w:left="360"/></w:pPr><w:rPr><w:color w:val="404040"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F2F1EC"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="MingLiU"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/></w:pPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/>
<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>
<w:top w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:left w:val="single" w:sz="4" w:space="0" w:color="808080"/>
<w:bottom w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:right w:val="single" w:sz="4" w:space="0" w:color="808080"/>
<w:insideH w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="808080"/>
</w:tblBorders></w:tblPr></w:style>
</w:styles>"""


def _footer() -> str:
    """The page-number footer in the interface language."""
    if not is_english():
        return FOOTER
    return (FOOTER.replace(">第 </w:t>", ">Page </w:t>").replace("> 頁　北科無人機社</w:t>", "> · NTUT Drone Club</w:t>"))


def export_table(path: str, title: str, headers: list[str], rows: list[list], subtitle: str = "",
                 align_right: set[int] | None = None) -> None:
    """One-call export of a table: title, export details, and the table (landscape when wide)."""
    wide = len(headers) > 6 or sum(_display_width(h) for h in headers) > 60
    doc = Document(title, landscape=wide)
    doc.title_block(title, subtitle)
    doc.table(headers, rows, align_right=align_right)
    doc.paragraph(f"共 {len(rows)} 筆", align="right", size=18)
    doc.save(path)
