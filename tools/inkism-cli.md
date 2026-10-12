# Inkism headless CLI

`tools/inkism-cli.mjs` sends one request to the packaged runtime and exits. It
is intended for scripts, CI, backup helpers, and a future OS deep-link handler.
Set `INKISM_ENGINE` or pass `--engine` when `inkism-engine` is not on `PATH`.

The database path is always explicit. The CLI never guesses a profile, creates
a missing database, or prints secrets. `sync now` only queues the configured
sync worker; it does not configure a server or expose a key.

Examples of commands are listed by `node tools/inkism-cli.mjs --help`.
