# Live AI eval (eval-ai-live.ts)

Opt-in check of "내 노트에 묻기" with typed relations and of wiki update proposals against a real
OpenAI-compatible chat server. Not part of CI. It runs the app's own retrieval, prompt builders
(`answerPrompt`, `wikiPrompt`), `completeAI` and parsers (`answerParts`, `cleanOutput`); only note
storage is in memory.

```sh
INKISM_LIVE_AI_ENDPOINT=<…/v1/chat/completions> INKISM_LIVE_AI_MODEL=<model> \
INKISM_LIVE_AI_RUNS=5 INKISM_LIVE_AI_VERBOSE=1 node scripts/eval-ai-live.ts
```

`INKISM_LIVE_AI_KEY` is optional; `INKISM_LIVE_AI_VERBOSE=2` prints every reply.

## Cases

- 12 relation questions (11 Korean, 1 English), each needing a typed edge (one needs two hops).
  Pass = expected fact present, at least one `[n]` that `answerParts` turns into a citation, no
  invented number, the far-end note cited, no citation standing in for a name ("숙소는 [1]이며"),
  no talk about the Relations block.
- 7 wiki proposals (Markdown and HTML, Korean and English, one with an unrelated source). Pass =
  `cleanOutput` gives a bare note body, existing facts kept, the new fact added, valid `[n]`
  citations, no number that is not in the note, a source or a citation, nothing from the unrelated
  source.

## Results (qwen3.8-flash, 5 runs, 2026-10-14)

| | before | after |
|---|---|---|
| relation answers | 58/60 (97%) | 57/60 (95%) |
| wiki proposals | 31/35 (89%) | 35/35 (100%) |

- Wiki: every "before" failure was the 60 s request timeout (whole-note rewrites took up to 79 s).
  Proposals now get 180 s (`WIKI_TIMEOUT`).
- Answers: the remaining failures are model noise (one 60 s timeout, one citation in place of a
  name, one "Relations에 따르면"). Citations used in place of names fell from 6/170 across all
  "before" runs to 1/60. A stricter wording ("never use a source number as a word") also fixed it
  but tripled reasoning tokens and timed out 8/55 answers, so the lighter "placed after the names
  and facts it supports" is used.
- Parsers now also accept a leading `<think>…</think>` block, `[1, 2]` citation lists and a one-line
  lead-in before a fenced note. This model never produced them; they are covered by unit tests.
