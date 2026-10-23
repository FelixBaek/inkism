#!/usr/bin/env python3
"""Reproducible local semantic search benchmark, synthetic data only.

Creates a NEW fixture directory under --directory (refuses an existing notes.db).
Use --reuse for a previously generated fixture to compare engine revisions.
Peak RSS comes from a fresh query-only engine process, excluding fixture creation.
"""
import argparse, hashlib, json, pathlib, statistics, struct, subprocess, time, sqlite3

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--engine', required=True, type=pathlib.Path)
p.add_argument('--directory', required=True, type=pathlib.Path)
p.add_argument('--notes', type=int, default=10000)
p.add_argument('--chunks', type=int, default=10)
p.add_argument('--dimensions', type=int, default=384)
p.add_argument('--runs', type=int, default=7)
p.add_argument('--reuse', action='store_true')
a = p.parse_args()
if not (1 <= a.notes <= 100000 and 1 <= a.chunks <= 100 and 1 <= a.dimensions <= 4096 and 1 <= a.runs <= 100):
    p.error('fixture size/runs out of bounds')
a.directory.mkdir(parents=True, exist_ok=True)
db = a.directory / 'notes.db'
metadata = a.directory / 'fixture.json'
shape = {'notes': a.notes, 'chunks_per_note': a.chunks, 'dimensions': a.dimensions}
engine = str(a.engine.resolve())
if not a.reuse:
    if db.exists():
        p.error('refusing to overwrite existing notes.db; use a new fixture directory')
    subprocess.run([engine, '--db', str(db)], input=b'{"op":"semantic_status","model":"benchmark"}\n', stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    with sqlite3.connect(db) as c:
        vectors = [struct.pack('<' + 'f' * a.dimensions, *[((i * 17 + variant * 31) % 127 - 63) / 64 for i in range(a.dimensions)]) for variant in range(127)]
        for n in range(a.notes):
            ident = f'benchmark-{n:08d}'
            text = ''.join((f'Synthetic note {n}, passage {k}. ' + 'benchmark text ' * 80)[:800] for k in range(a.chunks))
            c.execute('INSERT INTO notes_meta(id,title,created_at,updated_at) VALUES(?,?,0,0)', (ident, ident))
            c.execute('INSERT INTO notes_body(note_id,content,text) VALUES(?,?,?)', (ident, text, text))
            c.executemany('INSERT INTO semantic_chunks VALUES(?,1,\'benchmark\',?,?,?,?,?,?)', [(ident,k,k*800,(k+1)*800,'synthetic',a.dimensions,vectors[(n*a.chunks+k)%127]) for k in range(a.chunks)])
            c.execute("INSERT INTO semantic_chunks VALUES(?,1,'benchmark',-1,0,?,'',0,?)", (ident,len(text),b''))
    metadata.write_text(json.dumps(shape))
elif not metadata.exists() or json.loads(metadata.read_text()) != shape:
    p.error('fixture dimensions differ; refusing to reuse')
query = {'op':'semantic_search','model':'benchmark','vector':[((i*17)%127-63)/64 for i in range(a.dimensions)],'limit':20}
rss = a.directory / 'query-rss-kib.txt'
with (a.directory / 'query-stderr.log').open('w') as err:
    proc = subprocess.Popen(['/usr/bin/time','-f','%M','-o',str(rss),engine,'--db',str(db)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err, text=True)
    durations, digest = [], None
    try:
        for _ in range(a.runs):
            start = time.perf_counter()
            proc.stdin.write(json.dumps(query)+'\n'); proc.stdin.flush()
            result = json.loads(proc.stdout.readline())
            durations.append((time.perf_counter()-start)*1000)
            assert result['ok'] and len(result['data']['items']) == 20, result
            current = hashlib.sha256(json.dumps(result['data'],sort_keys=True).encode()).hexdigest()
            assert digest is None or current == digest, 'results changed between identical queries'
            digest = current
    finally:
        proc.stdin.close()
        try: proc.wait(timeout=30)
        except subprocess.TimeoutExpired: proc.kill();proc.wait();raise
    assert proc.returncode == 0
print(json.dumps({**shape,'chunks_total':a.notes*a.chunks,'runs':a.runs,'cold_ms':durations[0],'warm_median_ms':statistics.median(durations[1:] or durations),'all_ms':durations,'peak_rss_kib':int(rss.read_text()),'result_sha256':digest,'engine_sha256':hashlib.sha256(a.engine.read_bytes()).hexdigest()},indent=2))
