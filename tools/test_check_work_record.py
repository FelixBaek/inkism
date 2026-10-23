import unittest

import check_work_record as w

GOOD = """fix(search): keep the query when the list reloads

Why: users wrote variables by hand and got lost.
Verified: node --test frontend/src/search.test.js passed; screenshot docs/shot.png
Limits: channel select not screenshotted (not run).

제목: 자동화 단계를 평소 말로 적기
이유: 사용자가 변수를 직접 적다가 헤맸다.
검증: node --test frontend/src/search.test.js 통과
"""


def exists(*paths):
    return lambda p: p in paths


class CommitRecordTest(unittest.TestCase):
    def test_a_full_record_passes(self):
        self.assertEqual(w.check_commit("a" * 40, GOOD, exists("frontend/src/search.test.js", "docs/shot.png")), [])

    def test_missing_why_and_verified_are_named(self):
        problems = w.check_commit("b" * 40, "Fix popup\n\nMoved the button.\n", exists())
        self.assertEqual([p.split(" ", 1)[1] for p in problems],
                         ["missing Why:", "missing Verified:", "missing 제목:", "missing 이유:", "missing 검증:"])

    def test_english_only_is_not_enough(self):
        english = GOOD.split("\n\n제목:")[0]
        problems = w.check_commit("f" * 40, english, exists("frontend/src/search.test.js", "docs/shot.png"))
        self.assertEqual([p.split(" ", 1)[1] for p in problems], ["missing 제목:", "missing 이유:", "missing 검증:"])

    def test_not_run_called_passed_and_missing_evidence_are_caught(self):
        msg = "X\n\nWhy: y\nVerified: see evaluations/run-9/result.json\n\n제목: x\n이유: y\n검증: go test 미실행, 통과\n"
        problems = w.check_commit("d" * 40, msg, exists())
        self.assertTrue(any("not run is also called passed" in p for p in problems))
        self.assertTrue(any("evaluations/run-9/result.json" in p for p in problems))

    def test_one_line_may_hold_a_passed_check_and_a_not_run_one(self):
        self.assertEqual(w.verified_problems("go vet passed; node tests not run (no node)", exists()), [])
        self.assertEqual(w.verified_problems("go test 통과, 스크린샷 미실행", exists()), [])
        self.assertEqual(len(w.verified_problems("node tests not run · passed", exists())), 1)


class InputTest(unittest.TestCase):
    def test_range_and_git_arguments(self):
        self.assertEqual(w.safe_range("origin/main..HEAD"), "origin/main..HEAD")
        for bad in ("-x..y", "a..b..c", "HEAD", "a..--output=x"):
            with self.assertRaises(SystemExit):
                w.safe_range(bad)
        with self.assertRaises(ValueError):
            w.git("log", "--output=/tmp/x")

    def test_evidence_paths(self):
        self.assertEqual(list(w.evidence_paths("ran `tools/a.py`, see https://x.io/a/b.md and v1.2/3")),
                         ["tools/a.py"])
        self.assertEqual(list(w.evidence_paths("Ran python3 tools/inkism-cli.mjs. See frontend/src/app.js:120.")),
                         ["tools/inkism-cli.mjs", "frontend/src/app.js"])
        self.assertEqual(list(w.evidence_paths("release notes for origin/main..HEAD; ran it")), [])

    def test_an_unknown_range_head_fails_instead_of_skipping(self):
        with self.assertRaises(SystemExit):
            w.check_range("HEAD..no-such-ref-here")


if __name__ == "__main__":
    unittest.main()
