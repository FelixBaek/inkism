#!/usr/bin/env python3
"""Install the existing ARM64 debug APK in an isolated, disposable emulator.

This is Android emulator acceptance, not physical-device or human IME proof.
Google APIs API 30 x86_64 supports ARM translation; the actual ABI list is
checked before installation. No app is rebuilt and no storage key is exported.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET
import zipfile


PACKAGE = "dev.felixbaek.inkism"
IMAGE = "system-images;android-30;google_apis;x86_64"
NEW_NOTE = {"New note", "New note (Ctrl+N)", "새 노트 만들기", "새 노트 만들기 (Ctrl+N)"}
TITLE = {"Note title", "노트 제목"}
BODY = {"Note body (rich text editor)", "노트 본문 (리치 텍스트 편집기)"}


def command(args, *, timeout=30, env=None, text=True, check=True, input=None):
    result = subprocess.run(args, capture_output=True, text=text, timeout=timeout,
                            env=env, input=input)
    if check and result.returncode:
        detail = result.stderr if text else result.stderr.decode(errors="replace")
        raise RuntimeError(f"{Path(args[0]).name} failed ({result.returncode}): {detail[-1200:]}")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", required=True, type=Path)
    parser.add_argument("--apk", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    options = parser.parse_args()
    sdk, apk, output = options.sdk.resolve(), options.apk.resolve(), options.output.resolve()
    adb = sdk / "platform-tools/adb"
    emulator = sdk / "emulator/emulator"
    managers = list((sdk / "cmdline-tools").glob("*/bin/avdmanager"))
    manager = next((item for item in managers if item.parts[-3] == "latest"), None)
    manager = manager or (sorted(managers)[-1] if managers else None)
    if not apk.is_file() or not adb.is_file() or not emulator.is_file() or manager is None:
        parser.error("An existing APK and installed SDK adb/emulator/avdmanager are required")
    with zipfile.ZipFile(apk) as bundle:
        if "lib/arm64-v8a/libinkism_mobile.so" not in bundle.namelist():
            parser.error("The selected APK does not contain the expected ARM64 mobile host")
    output.mkdir(parents=True, exist_ok=True)
    report = {"environment": "disposable Android API30 Google APIs emulator",
              "apk_sha256": hashlib.sha256(apk.read_bytes()).hexdigest(),
              "package": PACKAGE, "system_image": IMAGE, "accepted": False,
              "physical_device": False, "checkpoints": []}
    child = None
    serial = None
    avd_name = None
    owned_device = False
    env = os.environ.copy()

    def device_identity():
        if child is None or child.poll() is not None:
            return False
        result = command([str(adb), "-s", serial, "emu", "avd", "name"],
                         timeout=10, env=env, check=False)
        return result.returncode == 0 and result.stdout.splitlines()[:1] == [avd_name]

    def android(*args, timeout=30, text=True, check=True):
        if not owned_device or not device_identity():
            raise RuntimeError("ADB serial no longer belongs to the AVD created by this test")
        return command([str(adb), "-s", serial, *args], timeout=timeout,
                       env=env, text=text, check=check)

    def wait_for(test, label, seconds=60):
        deadline = time.monotonic() + seconds
        last = None
        while time.monotonic() < deadline:
            if child is not None and child.poll() is not None:
                raise RuntimeError(f"Emulator exited before {label}")
            try:
                value = test()
                if isinstance(value, ET.Element) or value:
                    return value
            except (RuntimeError, subprocess.TimeoutExpired, ET.ParseError) as error:
                last = str(error)
            time.sleep(1)
        raise RuntimeError(f"Timed out waiting for {label}" + (f": {last}" if last else ""))

    def hierarchy(name):
        android("shell", "uiautomator", "dump", "/sdcard/inkism-acceptance.xml", timeout=20)
        raw = android("exec-out", "cat", "/sdcard/inkism-acceptance.xml").stdout
        (output / f"{name}.xml").write_text(raw)
        return ET.fromstring(raw)

    def labelled(tree, labels):
        return next((node for node in tree.iter("node")
                     if node.get("package") == PACKAGE and
                     (node.get("content-desc") in labels or node.get("text") in labels)), None)

    def field_text(node):
        if node is None:
            return ""
        return " ".join(item.get("text", "") for item in node.iter("node") if item.get("text")).strip()

    def screenshot(name):
        image = android("exec-out", "screencap", "-p", text=False).stdout
        if not image.startswith(b"\x89PNG\r\n\x1a\n"):
            raise RuntimeError("Android screenshot did not produce a PNG")
        (output / f"{name}.png").write_bytes(image)

    def tap(node):
        bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
        if not bounds:
            raise RuntimeError("The actual Android control has no bounds")
        left, top, right, bottom = map(int, bounds.groups())
        if right <= left or bottom <= top:
            raise RuntimeError("The actual Android control is not visible")
        android("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))

    def storage():
        names = android("shell", "run-as", PACKAGE, "find", ".", "-type", "f", "-name", "notes.db").stdout.splitlines()
        if len(names) != 1 or not re.fullmatch(r"\./[A-Za-z0-9_./-]+", names[0]):
            raise RuntimeError("Expected exactly one notes.db inside the fresh app sandbox")
        database = names[0]
        header = android("exec-out", "run-as", PACKAGE, "head", "-c", "16", database, text=False).stdout
        marker = android("exec-out", "run-as", PACKAGE, "cat", database + ".mobile-key", text=False).stdout
        if len(header) != 16 or header == b"SQLite format 3\x00":
            raise RuntimeError("The installed mobile library is absent or plaintext")
        prefix = b"INKISM-MOBILE-KEY-1\n"
        if not marker.startswith(prefix) or len(marker) > 128:
            raise RuntimeError("The installed mobile key identity marker is invalid")
        uuid.UUID(marker[len(prefix):].decode("ascii"))
        return {"database": database,
                "encrypted_header_sha256": hashlib.sha256(header).hexdigest(),
                "key_identity_sha256": hashlib.sha256(marker).hexdigest()}

    def launch():
        launched = android("shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1")
        (output / "launch.txt").write_text(launched.stdout + launched.stderr)
        wait_for(lambda: android("shell", "pidof", PACKAGE, check=False).stdout.strip(), "native application process")

    scratch = tempfile.TemporaryDirectory(prefix="inkism-android-acceptance-")
    try:
        sandbox = Path(scratch.name)
        env["ANDROID_AVD_HOME"] = str(sandbox / "avd")
        env["ANDROID_USER_HOME"] = str(sandbox / "android-user")
        Path(env["ANDROID_AVD_HOME"]).mkdir()
        Path(env["ANDROID_USER_HOME"]).mkdir()
        avd_name = "inkism_acceptance_" + uuid.uuid4().hex
        port = None
        for candidate in range(5554, 5682, 2):
            with socket.socket() as console, socket.socket() as adb_port:
                try:
                    console.bind(("127.0.0.1", candidate))
                    adb_port.bind(("127.0.0.1", candidate + 1))
                except OSError:
                    continue
                port = candidate
                break
        if port is None:
            raise RuntimeError("No unused emulator console/ADB port pair")
        serial = f"emulator-{port}"
        report["serial"] = serial
        command([str(manager), "create", "avd", "-n", avd_name, "-k", IMAGE, "-d", "pixel_4"],
                timeout=90, env=env, input="no\n")
        config = Path(env["ANDROID_AVD_HOME"]) / f"{avd_name}.avd/config.ini"
        with config.open("a") as file:
            file.write("\nhw.keyboard=yes\n")
        with (output / "emulator.log").open("w") as log:
            child = subprocess.Popen([str(emulator), "-avd", avd_name, "-port", str(port),
                                      "-no-window", "-no-audio", "-no-snapshot", "-no-boot-anim",
                                      "-gpu", "swiftshader", "-accel", "on"],
                                     stdout=log, stderr=subprocess.STDOUT, env=env)
            wait_for(lambda: command([str(adb), "-s", serial, "shell", "getprop", "sys.boot_completed"],
                                     timeout=10, env=env, check=False).stdout.strip() == "1", "emulator boot", 300)
            if not device_identity():
                raise RuntimeError("The booted ADB serial is not this test's fresh AVD; no device mutations were sent")
            owned_device = True
            report["fresh_avd_identity_verified"] = True
            android("shell", "input", "keyevent", "82")
            abis = android("shell", "getprop", "ro.product.cpu.abilist").stdout.strip().split(",")
            report["advertised_abis"] = abis
            if "arm64-v8a" not in abis:
                raise RuntimeError("The actual emulator does not advertise ARM64 translation; APK acceptance was not run")
            installed = android("install", "--no-streaming", str(apk), timeout=120)
            (output / "install.txt").write_text(installed.stdout + installed.stderr)
            if "Success" not in installed.stdout:
                raise RuntimeError("Android package installation did not report success")
            report["checkpoints"].append("Existing ARM64 APK installed without rebuilding")
            launch()
            start = wait_for(lambda: labelled(hierarchy("startup"), NEW_NOTE), "rendered note UI")
            original = storage()
            screenshot("startup")
            report["storage_before"] = original
            report["checkpoints"].append("Native process, actual note UI and encrypted library opened")
            tap(start)
            title = wait_for(lambda: labelled(hierarchy("new-note"), TITLE), "new note title control")
            tap(title)
            title_marker = "inkism_android_acceptance_" + uuid.uuid4().hex[:12]
            android("shell", "input", "text", title_marker)
            wait_for(lambda: field_text(labelled(hierarchy("typed-title"), TITLE)) == title_marker, "native title input")
            body = wait_for(lambda: labelled(hierarchy("editor"), BODY), "rich note body control")
            tap(body)
            body_marker = "native_android_body_" + uuid.uuid4().hex[:12]
            android("shell", "input", "text", body_marker)
            wait_for(lambda: field_text(labelled(hierarchy("typed-body"), BODY)) == body_marker, "native body input")
            # Allow the ordinary checkpoint/save path to settle before an OS stop.
            time.sleep(5)
            screenshot("edited")
            android("shell", "am", "force-stop", PACKAGE)
            launch()
            wait_for(lambda: labelled(hierarchy("restarted"), TITLE), "restarted editor")
            def restored_note():
                tree = hierarchy("restored")
                return (field_text(labelled(tree, TITLE)) == title_marker
                        and field_text(labelled(tree, BODY)) == body_marker)

            restored = wait_for(restored_note, "saved note title and body after restart")
            after = storage()
            if after != original:
                raise RuntimeError("Restart replaced the encrypted library or mobile key identity")
            screenshot("restored")
            report["storage_after"] = after
            report["checkpoints"].append("Native virtual-key title/body input survives force-stop/relaunch with the same encrypted library and key identity")
            report["accepted"] = bool(restored)
            print("PASS: existing Android ARM64 APK installed; native note UI/input, encrypted library and unchanged key identity survive restart; emulator, not physical-device IME")
    except Exception as error:
        report["failure"] = str(error)
        raise
    finally:
        if child is not None:
            try:
                if owned_device and device_identity():
                    logs = android("logcat", "-d", "-t", "1500", timeout=20, check=False).stdout
                    (output / "android-logcat.txt").write_text(logs)
            except (RuntimeError, subprocess.TimeoutExpired):
                pass
            if child.poll() is None:
                try:
                    if owned_device and device_identity():
                        android("emu", "kill", timeout=10, check=False)
                except (OSError, subprocess.TimeoutExpired):
                    pass
                try:
                    child.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=10)
        try:
            scratch.cleanup()
            report["temporary_avd_removed"] = True
        except OSError as error:
            report["accepted"] = False
            report["cleanup_failure"] = str(error)
            raise
        finally:
            (output / "android-results.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
