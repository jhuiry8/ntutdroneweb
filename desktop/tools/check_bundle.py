"""Check that every DLL the built program links is either bundled or part of Windows itself.

    python tools/check_bundle.py dist/ClubDesk

The build machine is a current Windows with the Visual C++ runtime and Python on PATH, so a
DLL left out of the bundle can still be found there and the program starts in CI. On a user's
Windows 7 the same program fails with "DLL load failed" (for example, Qt5Qml.dll, which
pyside2.abi3.dll links). This script reads the import table of every .exe/.dll/.pyd in the
folder (with pefile, which PyInstaller installs on Windows) and fails when an import is:
  * not in the bundle and not in the Windows system folder, or
  * a runtime the program must ship itself (VC++ runtime, Python), even if this machine has it.
"""

import os
import sys

import pefile

# Found in System32 on the build machine, but not on a clean Windows 7: these must be bundled.
MUST_BUNDLE = ("msvcp140", "vcruntime140", "concrt140", "python3")
# Resolved by Windows itself through API sets (UCRT on Windows 7 comes from KB2999226).
API_SET_PREFIXES = ("api-ms-win-", "ext-ms-win-")


def imports_of(path: str) -> list:
    pe = pefile.PE(path, fast_load=True)
    try:
        pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"]])
        return [entry.dll.decode("ascii", "replace") for entry in getattr(pe, "DIRECTORY_ENTRY_IMPORT", [])]
    finally:
        pe.close()


def main(folder: str) -> int:
    system = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")
    files = []
    for root, _dirs, names in os.walk(folder):
        files += [os.path.join(root, name) for name in names]
    bundled = {os.path.basename(path).lower() for path in files}

    problems = []
    for path in files:
        if not path.lower().endswith((".exe", ".dll", ".pyd")):
            continue
        try:
            imports = imports_of(path)
        except pefile.PEFormatError as error:
            problems.append(f"{os.path.relpath(path, folder)} is not a valid Windows binary ({error})")
            continue
        for dll in imports:
            name = dll.lower()
            if name in bundled or name.startswith(API_SET_PREFIXES):
                continue
            if name.startswith(MUST_BUNDLE) or not os.path.exists(os.path.join(system, dll)):
                problems.append(f"{os.path.relpath(path, folder)} needs {dll}, which is not bundled")

    for problem in sorted(set(problems)):
        print(problem)
    print(f"Checked {len(files)} files: {'OK' if not problems else f'{len(problems)} missing DLL(s)'}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else os.path.join("dist", "ClubDesk")))
