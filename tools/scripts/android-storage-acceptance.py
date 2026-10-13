#!/usr/bin/env python3
"""Observe an existing Android APK's storage across restart, without UI automation.

Uses the provenance contract and disposable AVD pattern from the separate
native-artifact acceptance helpers. Only non-secret hashes/metadata are saved.
This checks the initialized encrypted library, not note-input persistence.
"""
import argparse
import hashlib
import io
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
ARTIFACT = {"id": 11806835059, "run": 38385364826,
            "head": "f3a14e34491e81b560149550a2eacac7dea10b3a",
            "name": "inkism-android-test-f3a14e34491e81b560149550a2eacac7dea10b3a",
            "archiveDigest": "sha256:247abc86fd0fe319f9a83b9b2f278eb11ad75aea06900afc2b28785bb58dab04",
            "sha256": "c401bbf526b474145bbe19eccadfe70b4de519b8cd52deba217ad094d68a3ae1"}


def command(args, *, timeout=30, env=None, text=True, check=True, input=None):
    result = subprocess.run(args, capture_output=True, text=text, timeout=timeout,
                            env=env, input=input)
    if check and result.returncode:
        raise RuntimeError(f"{Path(args[0]).name} failed ({result.returncode})")
    return result


def prepare(output):
    repository = os.environ.get("GITHUB_REPOSITORY", "FelixBaek/inkism")
    if repository != "FelixBaek/inkism":
        raise RuntimeError("Pinned artifact belongs to FelixBaek/inkism")
    endpoint = f"repos/{repository}/actions/artifacts/{ARTIFACT['id']}"
    metadata = json.loads(command(["gh", "api", endpoint]).stdout)
    if (metadata["id"] != ARTIFACT["id"] or metadata.get("expired") is not False
            or metadata.get("name") != ARTIFACT["name"] or metadata.get("digest") != ARTIFACT["archiveDigest"]
            or metadata.get("workflow_run", {}).get("id") != ARTIFACT["run"]
            or metadata.get("workflow_run", {}).get("head_sha") != ARTIFACT["head"]):
        raise RuntimeError("Pinned APK artifact provenance/expiry mismatch")
    archive = command(["gh", "api", endpoint + "/zip"], timeout=180, text=False).stdout
    digest = "sha256:" + hashlib.sha256(archive).hexdigest()
    if len(archive) > 300 * 1024 * 1024 or digest != metadata.get("digest"):
        raise RuntimeError("Pinned artifact archive digest/size mismatch")
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        items = bundle.infolist()
        if len(items) > 20000 or any(PurePosixPath(item.filename).is_absolute()
                or ".." in PurePosixPath(item.filename).parts
                or (item.external_attr >> 16) & 0o170000 == 0o120000 for item in items):
            raise RuntimeError("Unsafe artifact paths")
        apks = [item for item in items if item.filename.endswith(".apk")]
        if len(apks) != 1 or apks[0].file_size > 300 * 1024 * 1024:
            raise RuntimeError("Expected exactly one bounded APK")
        payload = bundle.read(apks[0])
    if hashlib.sha256(payload).hexdigest() != ARTIFACT["sha256"]:
        raise RuntimeError("Pinned APK binary checksum mismatch")
    with zipfile.ZipFile(io.BytesIO(payload)) as apk:
        if "lib/arm64-v8a/libinkism_mobile.so" not in apk.namelist():
            raise RuntimeError("Pinned APK has no ARM64 native host")
    target = output / "verified.apk"
    target.write_bytes(payload)
    (output / "apk-provenance.json").write_text(json.dumps(
        {**ARTIFACT, "artifactName": metadata["name"], "archiveDigest": digest}, indent=2) + "\n")
    return target


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
        for identity in ("inode", "uid", "mode"):
            if before[field][identity] != after[field][identity]:
                raise RuntimeError("Restart replaced an app-private storage file")
    if after["database"]["bytes"] < before["database"]["bytes"]:
        raise RuntimeError("Restart truncated the initialized encrypted database")


def storage_failures(logs):
    patterns = ("AndroidKeyStore is unavailable", "mobile storage key is missing",
                "invalid mobile key", "file is not a database", "database disk image is malformed",
                "thread 'main' panicked", "FATAL EXCEPTION")
    return [pattern for pattern in patterns if pattern.lower() in logs.lower()]


def require_open_database(absolute, links):
    if absolute not in links.splitlines():
        raise RuntimeError("Owned native app has no observable open database descriptor")


def descriptor_command(pid):
    if type(pid) is not int or pid <= 0:
        raise RuntimeError("Invalid owned process PID")
    loop = f'for fd in /proc/{pid}/fd/*; do readlink "$fd"; done'
    # adb shell joins argv without escaping; preserve sh -c's script as one
    # remote-shell argument, including its loop and literal $fd expansion.
    return ["run-as", PACKAGE, "sh", "-c", shlex.quote(loop)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.sdk is None or args.output is None:
        parser.error("--sdk and --output are required")
    sdk, output = args.sdk.resolve(), args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = {"artifact": ARTIFACT, "harnessHead": os.environ.get("GITHUB_SHA"),
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
        mode, size, inode, uid = android("shell", "run-as", PACKAGE, "stat", "-c", "%a:%s:%i:%u", path).stdout.strip().split(":")
        return {"mode": int(mode, 8), "bytes": int(size), "inode": int(inode), "uid": int(uid)}

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
                "observedLinkCount": len(links.stdout.splitlines()),
                "matchedDatabase": absolute in links.stdout.splitlines(),
                "permissionDenied": "permission denied" in diagnostics,
                "shellSyntaxError": "syntax error" in diagnostics}
            # Unavailable proc-fd observations fail; process liveness alone is insufficient.
            require_open_database(absolute, links.stdout)
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
        apk = prepare(output)
        report["checkpoints"].append("Exact existing APK provenance and checksum verified")
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
                raise RuntimeError("Pinned APK installation failed")
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
            print("PASS: pinned Android APK encrypted storage reopens with the same private database and key identity; no UI checks")
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
    db = {"mode": 0o600, "bytes": 4096, "inode": 10, "uid": 10001}
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
    for change in ({"identityHash": "changed"}, {"database": {**db, "inode": 12}}, {"database": {**db, "bytes": 0}}):
        try:
            same_storage(valid, {**valid, **change})
        except RuntimeError:
            continue
        raise AssertionError("Replaced/truncated storage passed")
    assert storage_failures("AndroidKeyStore is unavailable")
    assert not storage_failures("Unrelated frontend syntax error")
    require_open_database("/data/user/0/app/notes.db", "/data/user/0/app/notes.db\n")
    for links in ("", "/data/user/0/app/notes.db-wal\n", "Permission denied\n"):
        try:
            require_open_database("/data/user/0/app/notes.db", links)
        except RuntimeError:
            continue
        raise AssertionError("Unavailable native database descriptor passed")
    # Exercise the actual two-shell boundary on a held disposable file, not
    # an Android/product substitute. Missing quoting must fail before reading.
    with tempfile.NamedTemporaryFile(prefix="inkism-fd-quote-") as held:
        argv = descriptor_command(os.getpid())
        prelude = 'run_as() { shift; "$@"; }; '
        quoted = " ".join(["run_as", *argv[1:]])
        unquoted = " ".join(["run_as", *argv[1:-1], shlex.split(argv[-1])[0]])
        bad = command(["/bin/sh", "-c", prelude + unquoted], check=False)
        good = command(["/bin/sh", "-c", prelude + quoted], check=False)
        assert bad.returncode != 0 and "syntax error" in bad.stderr.lower()
        require_open_database(held.name, good.stdout)
    print("PASS: storage oracle rejects plaintext, unsafe paths/markers/permissions/UIDs, replaced keys/inodes and truncated databases")
    print("PASS: actual held-file descriptor survives correctly quoted remote sh -c; unquoted loop fails")


if __name__ == "__main__":
    main()
