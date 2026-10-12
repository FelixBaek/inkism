// Node 22+: node --experimental-strip-types frontend/scripts/test-csv.ts
import assert from 'node:assert/strict';
import {parseCsv} from '../src/lib/csv.ts';
assert.deepEqual(parseCsv('a,b\r\n1,2\n'),[['a','b'],['1','2']]);
assert.deepEqual(parseCsv('﻿이름,"메모, 쉼표"\n"따옴표 ""안""",\n'),[['이름','메모, 쉼표'],['따옴표 "안"','']]);
assert.deepEqual(parseCsv('"여러\n줄",x'),[['여러\n줄','x']]);
assert.deepEqual(parseCsv(''),[]);
console.log('PASS: CSV quotes, escapes, BOM, CRLF and multi-line fields');

assert.throws(()=>parseCsv('"unclosed',{maxCells:10,maxColumns:10,strict:true}),/quoted/);
assert.throws(()=>parseCsv('"a"junk,b',{maxCells:10,maxColumns:10,strict:true}),/quoted/);
assert.throws(()=>parseCsv('a,b,c',{maxCells:2,maxColumns:10}),/limit/);
assert.throws(()=>parseCsv('a,b,c',{maxCells:10,maxColumns:2}),/limit/);
assert.deepEqual(parseCsv('"",x\r\n"a""b",',{maxCells:10,maxColumns:2,strict:true}),[['','x'],['a"b','']]);
console.log('PASS bounded strict CSV parsing rejects malformed quotes and limits before accumulating oversized rows');
