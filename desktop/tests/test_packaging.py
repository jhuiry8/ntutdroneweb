"""ClubDesk.spec must keep every Qt module the program imports, and qtcompat must alias it for PySide2."""

import ast
import glob
import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")


def used_qt_modules() -> set:
    found = set()
    files = glob.glob(os.path.join(ROOT, "clubdesk", "**", "*.py"), recursive=True) + [os.path.join(ROOT, "main.py")]
    for path in files:
        with open(path, encoding="utf-8") as handle:
            for node in ast.walk(ast.parse(handle.read())):
                if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("PySide6."):
                    found.add(node.module.split(".")[1])
    return found


class PackagingTests(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, "ClubDesk.spec"), encoding="utf-8") as handle:
            self.spec = handle.read()
        with open(os.path.join(ROOT, "clubdesk", "qtcompat.py"), encoding="utf-8") as handle:
            self.compat = handle.read()

    def test_spec_does_not_exclude_modules_the_program_imports(self):
        unused = re.search(r"_UNUSED_QT = \[(.*?)\]", self.spec, re.S).group(1)
        excluded = set(re.findall(r'"(Qt\w+)"', unused))
        self.assertIn("QtNetwork", used_qt_modules())  # single_instance
        self.assertEqual(excluded & used_qt_modules(), set())

    def test_spec_does_not_drop_files_of_used_modules(self):
        drop = re.search(r'DROP = re.compile\(r"""(.*?)"""\)', self.spec, re.S).group(1)
        pattern = re.compile(r"(?ix)" + drop)
        for module in used_qt_modules():
            name = module[2:]  # QtNetwork -> Network
            for sample in (f"PySide6/{module}.pyd", f"PySide6/{module}.abi3.so", f"PySide6/Qt6{name}.dll",
                           f"PySide6/libQt6{name}.so.6", f"PySide2/Qt5{name}.dll"):
                self.assertIsNone(pattern.search("/" + sample), sample)

    def test_pyside2_edition_bundles_and_aliases_every_used_module(self):
        for module in used_qt_modules():
            self.assertIn(f'"PySide2.{module}"', self.spec, module)
            self.assertIn(f'"{module}"', self.compat, module)


if __name__ == "__main__":
    unittest.main()
