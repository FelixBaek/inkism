# inkism sync relay: static Rust binary (SQLite inside) on scratch.
# Build context is the packaged dist/sync-relay directory.
FROM scratch

COPY inkism-sync-relay /inkism-sync-relay
# Google signature keys are fetched over verified HTTPS.
COPY ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

# Pre-create /data owned by the runtime user so the named volume
# inherits correct ownership on first use.
COPY --chown=65532:65532 state/ /data/

USER 65532:65532

ENTRYPOINT ["/inkism-sync-relay"]
