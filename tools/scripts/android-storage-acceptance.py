#!/usr/bin/env python3
"""Observe this checkout's Android APK storage across restart, without UI automation.

Uses a same-job build receipt and a disposable AVD. Only non-secret hashes/metadata are saved.
This checks the initialized encrypted library, not note-input persistence.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import socket
import subprocess
import tempfile
import time
import uuid
import zipfile


PACKAGE = "dev.felixbaek.inkism"
IMAGE = "system-images;android-35;google_apis;x86_64"
APK_PATH = "desktop-tauri/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"
BUILD_RECIPE = "node tools/platform-build.mjs android"


def command(args, *, timeout=30, env=None, text=True, check=True, input=None):
    result = subprocess.run(args, capture_output=True, text=text, timeout=timeout,
                            env=env, input=input)
    if check and result.returncode:
        raise RuntimeError(f"{Path(args[0]).name} failed ({result.returncode})")
    return result


def source_context(checkout, environment=None):
    environment = os.environ if environment is None else environment
    source = command(["git", "-C", str(checkout), "rev-parse", "HEAD"]).stdout.strip()
    run_id = environment.get("GITHUB_RUN_ID", "")
    repository = environment.get("GITHUB_REPOSITORY", "")
    if not re.fullmatch(r"[0-9a-f]{40}", source) or environment.get("GITHUB_SHA") != source:
        raise RuntimeError("Build source is not the current workflow checkout")
    if not re.fullmatch(r"[1-9][0-9]*", run_id) or repository != "FelixBaek/inkism":
        raise RuntimeError("Build requires this repository's current workflow run identity")
    return {"sourceSha": source, "sourceRunId": run_id, "repository": repository}


def inspect_apk(apk, checkout):
    checkout = checkout.resolve()
    apk = apk if apk.is_absolute() else checkout / apk
    expected = checkout / APK_PATH
    if apk.resolve() != expected or any((checkout / parent).is_symlink() for parent in PurePosixPath(APK_PATH).parents):
        raise RuntimeError("APK is not the current checkout's generated build output")
    if apk.is_symlink() or not apk.is_file() or not 20 <= apk.stat().st_size <= 300 * 1024 * 1024:
        raise RuntimeError("Missing or invalid current APK file")
    with zipfile.ZipFile(apk) as bundle:
        names = bundle.namelist()
        if len(names) != len(set(names)) or len(names) > 20000 or any(
                name not in names for name in ("AndroidManifest.xml", "classes.dex", "lib/arm64-v8a/libinkism_mobile.so")):
            raise RuntimeError("APK lacks its Android manifest/classes or ARM64 host")
        with bundle.open("lib/arm64-v8a/libinkism_mobile.so") as native:
            header = native.read(20)
        if len(header) != 20 or header[:6] != b"\x7fELF\x02\x01" or int.from_bytes(header[18:20], "little") != 183:
            raise RuntimeError("APK native host is not an ARM64 ELF binary")
    hasher = hashlib.sha256()
    with apk.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return {"apkPath": APK_PATH, "apkSha256": hasher.hexdigest(), "apkBytes": apk.stat().st_size}


def validate_receipt(receipt, apk, checkout, context):
    actual = {"schemaVersion": 1, "recipe": BUILD_RECIPE, **context, **inspect_apk(apk, checkout)}
    if receipt != actual:
        raise RuntimeError("APK build receipt source/run/recipe/path/hash mismatch")
    return actual


def validate_storage(relative, header, marker, db_stat, key_stat, app_uid):
    path = PurePosixPath(relative)
    if (not relative.startswith("./") or path.is_absolute() or ".." in path.parts
            or not re.fullmatch(r"\./[A-Za-z0-9_./-]+", relative) or path.name != "notes.db"):
        raise RuntimeError("Database path escaped the disposable app sandbox")
    if len(header) != 16 or header == b"SQLite format 3\0" or header == bytes(16) or db_stat["bytes"] < 4096:
        raise RuntimeError("Installed library is absent or plaintext")
    if not re.fullmatch(rb"INKISM-MOBILE-KEY-1\n[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", marker, re.I):
        raise RuntimeError("Invalid non-secret mobile key identity marker")
    for metadata in (db_stat, key_stat):
        if metadata["mode"] & 0o077 or metadata["uid"] != app_uid:
            raise RuntimeError("Database/key identity is not private to the installed app")
    if key_stat["bytes"] != len(marker):
        raise RuntimeError("Mobile identity marker changed during observation")
    return {"relativePath": str(path), "encryptedHeaderHash": hashlib.sha256(header).hexdigest(),
            "identityHash": hashlib.sha256(marker).hexdigest(),
            "database": db_stat, "keyIdentity": key_stat}


def same_storage(before, after):
    for field in ("relativePath", "encryptedHeaderHash", "identityHash"):
        if before[field] != after[field]:
            raise RuntimeError("Restart replaced the encrypted library or key identity")
    for field in ("database", "keyIdentity"):
        for identity in ("device", "inode", "uid", "mode"):
            if before[field][identity] != after[field][identity]:
                raise RuntimeError("Restart replaced an app-private storage file")
    if after["database"]["bytes"] < before["database"]["bytes"]:
        raise RuntimeError("Restart truncated the initialized encrypted database")


def storage_failures(logs):
    patterns = ("AndroidKeyStore is unavailable", "mobile storage key is missing",
                "invalid mobile key", "file is not a database", "database disk image is malformed",
                "thread 'main' panicked", "FATAL EXCEPTION")
    return [pattern for pattern in patterns if pattern.lower() in logs.lower()]


def descriptor_identities(observations):
    return {tuple(map(int, line.split(":"))) for line in observations.splitlines()
            if re.fullmatch(r"[0-9]+:[0-9]+", line)}


def require_open_database(database, observations):
    if (database["device"], database["inode"]) not in descriptor_identities(observations):
        raise RuntimeError("Owned native app has no observable open database descriptor")


def descriptor_command(pid):
    if type(pid) is not int or pid <= 0:
        raise RuntimeError("Invalid owned process PID")
    loop = f'for fd in /proc/{pid}/fd/*; do stat -L -c "%d:%i" "$fd"; done'
    # adb shell joins argv without escaping; preserve sh -c's script as one
    # remote-shell argument, including its loop and literal $fd expansion.
    return ["run-as", PACKAGE, "sh", "-c", shlex.quote(loop)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--apk", type=Path)
    parser.add_argument("--build-receipt", type=Path)
    parser.add_argument("--record-build", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.apk is None or args.build_receipt is None:
        parser.error("--apk and --build-receipt are required")
    checkout = Path(__file__).resolve().parents[2]
    context = source_context(checkout)
    if args.record_build:
        receipt = {"schemaVersion": 1, "recipe": BUILD_RECIPE, **context, **inspect_apk(args.apk, checkout)}
        args.build_receipt.parent.mkdir(parents=True, exist_ok=True)
        args.build_receipt.write_text(json.dumps(receipt, indent=2) + "\n")
        print("PASS: current-checkout APK build receipt recorded")
        return
    if args.sdk is None or args.output is None:
        parser.error("--sdk and --output are required for storage acceptance")
    sdk, output = args.sdk.resolve(), args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = {"harnessHead": context["sourceSha"],
              "systemImage": IMAGE, "accepted": False, "uiChecksRun": False,
              "physicalDevice": False, "checkpoints": []}
    adb, emulator = sdk / "platform-tools/adb", sdk / "emulator/emulator"
    managers = sorted((sdk / "cmdline-tools").glob("*/bin/avdmanager"))
    manager = next((item for item in managers if item.parts[-3] == "latest"), None)
    manager = manager or (managers[-1] if managers else None)
    if not adb.is_file() or not emulator.is_file() or manager is None:
        parser.error("Installed SDK adb/emulator/avdmanager are required")
    child, serial, avd_name, owned = None, None, None, False
    env = os.environ.copy()

    def device_identity():
        if child is None or child.poll() is not None:
            return False
        result = command([str(adb), "-s", serial, "emu", "avd", "name"], env=env, timeout=10, check=False)
        return result.returncode == 0 and result.stdout.splitlines()[:1] == [avd_name]

    def android(*argv, timeout=30, text=True, check=True):
        if not owned or not device_identity():
            raise RuntimeError("ADB serial is no longer the AVD owned by this test")
        return command([str(adb), "-s", serial, *argv], env=env, timeout=timeout, text=text, check=check)

    def wait_for(test, label, seconds=60):
        deadline, last = time.monotonic() + seconds, None
        while time.monotonic() < deadline:
            if child is not None and child.poll() is not None:
                raise RuntimeError("Owned emulator exited")
            try:
                result = test()
                if result:
                    return result
            except (RuntimeError, subprocess.TimeoutExpired) as error:
                last = str(error)
            time.sleep(1)
        raise RuntimeError(f"Timed out waiting for {label}: {last or 'not ready'}")

    def app_process():
        pid = android("shell", "pidof", PACKAGE, check=False).stdout.strip()
        if not re.fullmatch(r"[1-9][0-9]*", pid):
            raise RuntimeError("Expected one installed app process")
        name = android("exec-out", "run-as", PACKAGE, "cat", f"/proc/{pid}/cmdline", text=False).stdout
        if name.split(b"\0", 1)[0] != PACKAGE.encode():
            raise RuntimeError("Process PID does not belong to the installed app")
        stat = android("shell", "run-as", PACKAGE, "cat", f"/proc/{pid}/stat").stdout
        return {"pid": int(pid), "startTicks": int(stat.rsplit(")", 1)[1].split()[19])}

    def file_stat(path):
        mode, size, device, inode, uid = android("shell", "run-as", PACKAGE, "stat", "-c", "%a:%s:%d:%i:%u", path).stdout.strip().split(":")
        return {"mode": int(mode, 8), "bytes": int(size), "device": int(device), "inode": int(inode), "uid": int(uid)}

    def digest(path):
        value = android("shell", "run-as", PACKAGE, "sha256sum", path).stdout.split()[0]
        if not re.fullmatch(r"[0-9a-f]{64}", value):
            raise RuntimeError("Storage file digest unavailable")
        return value

    def snapshot(opened=False):
        names = android("shell", "run-as", PACKAGE, "find", ".", "-type", "f", "-name", "notes.db").stdout.splitlines()
        if len(names) != 1:
            raise RuntimeError("Expected one database in the fresh app sandbox")
        database = names[0]
        # Validate shell arguments before using paths in a run-as observation.
        if not re.fullmatch(r"\./[A-Za-z0-9_./-]+", database) or ".." in PurePosixPath(database).parts:
            raise RuntimeError("Unsafe database path")
        header = android("exec-out", "run-as", PACKAGE, "head", "-c", "16", database, text=False).stdout
        marker = android("exec-out", "run-as", PACKAGE, "head", "-c", "129", database + ".mobile-key", text=False).stdout
        uid = int(android("shell", "run-as", PACKAGE, "id", "-u").stdout.strip())
        observed = validate_storage(database, header, marker, file_stat(database), file_stat(database + ".mobile-key"), uid)
        observed["databaseHash"] = digest(database)
        wal = database + "-wal"
        wal_present = android("shell", "run-as", PACKAGE, "test", "-f", wal, check=False).returncode
        if wal_present not in (0, 1):
            raise RuntimeError("WAL presence could not be observed")
        if wal_present == 0:
            observed["wal"] = {**file_stat(wal), "sha256": digest(wal)}
        else:
            observed["wal"] = None
        if opened:
            process = app_process()
            root = android("shell", "run-as", PACKAGE, "readlink", "-f", ".").stdout.strip()
            absolute = android("shell", "run-as", PACKAGE, "readlink", "-f", database).stdout.strip()
            if not absolute.startswith(root + "/"):
                raise RuntimeError("Database resolved outside the app sandbox")
            links = android("shell", *descriptor_command(process["pid"]), check=False)
            report["lastStorageObservation"] = observed
            diagnostics = (links.stdout + links.stderr).lower()
            report["databaseDescriptorObservation"] = {
                "process": process, "commandExitCode": links.returncode,
                "observedIdentityCount": len(descriptor_identities(links.stdout)),
                "matchedDatabase": (observed["database"]["device"], observed["database"]["inode"]) in descriptor_identities(links.stdout),
                "permissionDenied": "permission denied" in diagnostics,
                "shellSyntaxError": "syntax error" in diagnostics}
            # Unavailable proc-fd observations fail; process liveness alone is insufficient.
            require_open_database(observed["database"], links.stdout)
            failures = storage_failures(android("logcat", "--pid", str(process["pid"]), "-d", "-v", "brief").stdout)
            if failures:
                raise RuntimeError("Native storage/process failure: " + ", ".join(failures))
            if app_process() != process:
                raise RuntimeError("App process changed during storage observation")
            observed["process"] = process
            observed["openDatabaseDescriptor"] = True
        return observed

    def launch(component):
        android("shell", "am", "start", "-W", "-n", component)
        initial = wait_for(lambda: snapshot(opened=True), "native encrypted backend initialization")
        # A transient fd during a failed open is insufficient. The same native
        # process must retain the database descriptor after initialization.
        time.sleep(2)
        settled = snapshot(opened=True)
        same_storage(initial, settled)
        if initial["process"] != settled["process"]:
            raise RuntimeError("Native process changed during backend initialization")
        return settled

    def stop():
        android("shell", "am", "force-stop", PACKAGE)
        wait_for(lambda: not android("shell", "pidof", PACKAGE, check=False).stdout.strip(), "app force-stop")

    scratch = tempfile.TemporaryDirectory(prefix="inkism-android-storage-")
    try:
        if args.build_receipt.stat().st_size > 65536:
            raise RuntimeError("Build receipt is oversized")
        provenance = validate_receipt(json.loads(args.build_receipt.read_text()), args.apk, checkout, context)
        apk = checkout / provenance["apkPath"]
        report["build"] = provenance
        (output / "apk-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
        report["checkpoints"].append("Same-job current-checkout APK recipe, run identity and binary checksum verified")
        for key, directory in (("ANDROID_AVD_HOME", "avd"), ("ANDROID_USER_HOME", "android-user"), ("ANDROID_EMULATOR_HOME", "emulator")):
            env[key] = str(Path(scratch.name) / directory)
            Path(env[key]).mkdir()
        avd_name = "inkism_storage_" + uuid.uuid4().hex
        port = None
        for candidate in range(5554, 5682, 2):
            with socket.socket() as console, socket.socket() as transport:
                try:
                    console.bind(("127.0.0.1", candidate)); transport.bind(("127.0.0.1", candidate + 1))
                except OSError:
                    continue
                port = candidate
                break
        if port is None:
            raise RuntimeError("No unused emulator port pair")
        serial = f"emulator-{port}"
        command([str(manager), "create", "avd", "-n", avd_name, "-k", IMAGE, "-d", "pixel_4"], env=env, timeout=90, input="no\n")
        with (output / "emulator.log").open("w") as log:
            child = subprocess.Popen([str(emulator), "-avd", avd_name, "-port", str(port), "-no-window", "-no-audio",
                                      "-no-snapshot", "-no-boot-anim", "-gpu", "swiftshader", "-accel", "on"], env=env, stdout=log, stderr=subprocess.STDOUT)
            wait_for(lambda: command([str(adb), "-s", serial, "shell", "getprop", "sys.boot_completed"], env=env, timeout=10, check=False).stdout.strip() == "1", "emulator boot", 300)
            if not device_identity():
                raise RuntimeError("Booted serial is not this test's fresh AVD")
            owned = True
            report.update({"serial": serial, "freshOwnedAvdVerified": True})
            abis = android("shell", "getprop", "ro.product.cpu.abilist").stdout.strip().split(",")
            if "arm64-v8a" not in abis:
                raise RuntimeError("Emulator lacks ARM64 translation")
            report["advertisedAbis"] = abis
            installed = android("install", "--no-streaming", str(apk), timeout=120)
            if "Success" not in installed.stdout:
                raise RuntimeError("Current APK installation failed")
            resolved = android("shell", "cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", PACKAGE).stdout.splitlines()
            components = [line for line in resolved if re.fullmatch(re.escape(PACKAGE) + r"/(?:\.|" + re.escape(PACKAGE) + r"\.)[A-Za-z0-9_.]+", line)]
            if len(components) != 1:
                raise RuntimeError("No unique installed app launcher activity")
            first = launch(components[0])
            report["firstStartup"] = first
            report["checkpoints"].append("Owned app opened an initialized encrypted database with private key identity")
            stop()
            before = snapshot()
            same_storage(first, before)
            report["beforeRestart"] = before
            second = launch(components[0])
            same_storage(before, second)
            if second["process"] == first["process"]:
                raise RuntimeError("Force-stop did not produce a new app process")
            report["secondStartup"] = second
            stop()
            after = snapshot()
            same_storage(before, after)
            report["afterRestart"] = after
            report["wholeDatabaseBytesUnchanged"] = before["databaseHash"] == after["databaseHash"]
            report["limitations"] = ["Initialized encrypted database reopen; no saved-note or attachment input roundtrip",
                                     "Whole encrypted file digests recorded; SQLite may checkpoint WAL on reopening"]
            report["checkpoints"].append("Fresh process reopened the same encrypted database inode/header and key identity after force-stop")
            report["accepted"] = True
            print("PASS: current-checkout Android APK encrypted storage reopens with the same private database and key identity; no UI checks")
    except Exception as error:
        report["failure"] = str(error)
        raise
    finally:
        cleanup_error = None
        try:
            if child is not None and child.poll() is None:
                try:
                    if owned and device_identity():
                        android("emu", "kill", timeout=10, check=False)
                except (RuntimeError, OSError, subprocess.TimeoutExpired):
                    pass
                try:
                    child.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    # Popen owns this exact live child; never kill a discovered
                    # device, another emulator or the shared ADB server.
                    child.kill()
                    child.wait(timeout=10)
            report["ownedEmulatorStopped"] = child is None or child.poll() is not None
        except (OSError, subprocess.TimeoutExpired):
            cleanup_error = "Owned emulator cleanup failed"
        try:
            scratch.cleanup()
            report["temporaryAvdRemoved"] = True
        except OSError:
            cleanup_error = "Disposable AVD cleanup failed"
        finally:
            if cleanup_error:
                report["accepted"] = False
                report["cleanupFailure"] = cleanup_error
            (output / "android-storage.json").write_text(json.dumps(report, indent=2) + "\n")
        if cleanup_error:
            raise RuntimeError(cleanup_error)


def self_test():
    marker = ("INKISM-MOBILE-KEY-1\n" + str(uuid.uuid4())).encode()
    db = {"mode": 0o600, "bytes": 4096, "device": 8, "inode": 10, "uid": 10001}
    key = {**db, "bytes": len(marker), "inode": 11}
    valid = validate_storage("./notes.db", bytes(range(16)), marker, db, key, 10001)
    same_storage(valid, json.loads(json.dumps(valid)))
    invalid = [("../notes.db", bytes(range(16)), marker, db, key, 10001),
               ("./notes.db", b"SQLite format 3\0", marker, db, key, 10001),
               ("./notes.db", bytes(range(16)), b"invalid marker", db, key, 10001),
               ("./notes.db", bytes(range(16)), marker, db, {**key, "mode": 0o644}, 10001),
               ("./notes.db", bytes(range(16)), marker, db, key, 10002)]
    for args in invalid:
        try:
            validate_storage(*args)
        except RuntimeError:
            continue
        raise AssertionError("Unsafe storage observation passed")
    for change in ({"identityHash": "changed"}, {"database": {**db, "device": 9}}, {"database": {**db, "inode": 12}}, {"database": {**db, "bytes": 0}}):
        try:
            same_storage(valid, {**valid, **change})
        except RuntimeError:
            continue
        raise AssertionError("Replaced/truncated storage passed")
    assert storage_failures("AndroidKeyStore is unavailable")
    assert not storage_failures("Unrelated frontend syntax error")
    require_open_database(db, "8:10\n")
    for links in ("", "8:11\n", "9:10\n", "Permission denied\n", "prefix 8:10 suffix\n"):
        try:
            require_open_database(db, links)
        except RuntimeError:
            continue
        raise AssertionError("Unavailable native database descriptor passed")
    # Exercise the actual two-shell boundary on a held disposable file, not
    # an Android/product substitute. Missing quoting must fail before reading.
    with tempfile.TemporaryDirectory(prefix="inkism-fd-quote-") as directory:
        original, alias = Path(directory) / "notes.db", Path(directory) / "database-alias"
        original.touch()
        os.link(original, alias)
        expected = {"device": original.stat().st_dev, "inode": original.stat().st_ino}
        argv = descriptor_command(os.getpid())
        prelude = 'run_as() { shift; "$@"; }; '
        quoted = " ".join(["run_as", *argv[1:]])
        unquoted = " ".join(["run_as", *argv[1:-1], shlex.split(argv[-1])[0]])
        with alias.open("rb"):
            bad = command(["/bin/sh", "-c", prelude + unquoted], check=False)
            good = command(["/bin/sh", "-c", prelude + quoted], check=False)
        assert bad.returncode != 0 and "syntax error" in bad.stderr.lower()
        require_open_database(expected, good.stdout)
    checkout = Path(__file__).resolve().parents[2]
    head = command(["git", "-C", str(checkout), "rev-parse", "HEAD"]).stdout.strip()
    environment = {"GITHUB_SHA": head, "GITHUB_RUN_ID": "12345", "GITHUB_REPOSITORY": "FelixBaek/inkism"}
    context = source_context(checkout, environment)
    try:
        source_context(checkout, {**environment, "GITHUB_SHA": "0" * 40})
    except RuntimeError:
        pass
    else:
        raise AssertionError("Wrong workflow checkout source passed")
    with tempfile.TemporaryDirectory(prefix="inkism-apk-receipt-") as directory:
        root = Path(directory)
        apk = root / APK_PATH
        apk.parent.mkdir(parents=True)
        native = bytearray(20)
        native[:6] = b"\x7fELF\x02\x01"
        native[18:20] = (183).to_bytes(2, "little")
        with zipfile.ZipFile(apk, "w") as bundle:
            bundle.writestr("AndroidManifest.xml", b"synthetic manifest")
            bundle.writestr("classes.dex", b"dex\n039\0")
            bundle.writestr("lib/arm64-v8a/libinkism_mobile.so", native)
        receipt = {"schemaVersion": 1, "recipe": BUILD_RECIPE, **context, **inspect_apk(apk, root)}
        validate_receipt(receipt, apk, root, context)
        for change in ({"sourceSha": "0" * 40}, {"sourceRunId": "67890"},
                       {"recipe": "other build"}, {"apkPath": "../foreign.apk"}, {"apkSha256": "0" * 64}):
            try:
                validate_receipt({**receipt, **change}, apk, root, context)
            except RuntimeError:
                continue
            raise AssertionError("Foreign/stale APK build receipt passed")
        for foreign in (root / "foreign.apk", root / "../foreign.apk"):
            try:
                inspect_apk(foreign, root)
            except RuntimeError:
                continue
            raise AssertionError("APK outside the generated build path passed")
        # A changed APK still parses, but its previous receipt must fail.
        with zipfile.ZipFile(apk, "a") as bundle:
            bundle.writestr("changed-resource", b"changed")
        try:
            validate_receipt(receipt, apk, root, context)
        except RuntimeError:
            pass
        else:
            raise AssertionError("Changed APK binary passed its old checksum")
        apk.write_bytes(b"not an APK")
        try:
            inspect_apk(apk, root)
        except (RuntimeError, zipfile.BadZipFile):
            pass
        else:
            raise AssertionError("Non-APK binary passed")
        apk.unlink()
        foreign = root / "foreign.apk"
        foreign.touch()
        apk.symlink_to(foreign)
        try:
            inspect_apk(apk, root)
        except RuntimeError:
            pass
        else:
            raise AssertionError("Symlinked foreign APK passed")
    print("PASS: storage oracle rejects plaintext, unsafe paths/markers/permissions/UIDs, replaced keys/inodes and truncated databases")
    print("PASS: actual same-file alias matches device/inode through quoted remote sh -c; unquoted loop and foreign DB/WAL identities fail")
    print("PASS: current checkout/run/recipe/APK path/binary hash receipt; foreign source/run/path/recipe/changed binary rejected")


if __name__ == "__main__":
    main()
