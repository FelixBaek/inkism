// Independent ZIP reader for browser gates; no Python/OS tools are required.
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
export function readZipEntries(bytes:Buffer):Map<string,Buffer> {
 let end=-1;
 for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--)
  if(bytes.readUInt32LE(offset)===0x06054b50&&offset+22+bytes.readUInt16LE(offset+20)===bytes.length){end=offset;break;}
 assert.ok(end>=0,'ZIP end record missing');
 assert.equal(bytes.readUInt16LE(end+4),0,'multi-disk ZIP unsupported');
 const count=bytes.readUInt16LE(end+10),centralSize=bytes.readUInt32LE(end+12);
 let offset=bytes.readUInt32LE(end+16);
 assert.equal(offset+centralSize,end,'invalid central directory');
 const entries=new Map<string,Buffer>();
 for(let index=0;index<count;index++) {
  assert.equal(bytes.readUInt32LE(offset),0x02014b50,'invalid central entry');
  const method=bytes.readUInt16LE(offset+10),crc=bytes.readUInt32LE(offset+16);
  const compressed=bytes.readUInt32LE(offset+20),size=bytes.readUInt32LE(offset+24);
  const nameSize=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32);
  const local=bytes.readUInt32LE(offset+42),name=bytes.subarray(offset+46,offset+46+nameSize).toString('utf8');
  assert.equal(bytes.readUInt32LE(local),0x04034b50,'invalid local entry');
  const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
  assert.ok(start+compressed<=bytes.length,'truncated ZIP entry');
  const raw=bytes.subarray(start,start+compressed);
  assert.ok(method===0||method===8,'unsupported compression');
  const content=method===0?Buffer.from(raw):inflateRawSync(raw);
  assert.equal(content.length,size,'ZIP entry size mismatch');
  let checksum=0xffffffff;
  for(const byte of content){checksum^=byte;for(let bit=0;bit<8;bit++)checksum=(checksum>>>1)^((checksum&1)?0xedb88320:0);}
  assert.equal((checksum^0xffffffff)>>>0,crc,'ZIP CRC mismatch');
  assert.equal(entries.has(name),false,'duplicate ZIP path');entries.set(name,content);
  offset+=46+nameSize+extra+comment;
 }
 assert.equal(offset,end,'central directory length mismatch');
 return entries;
}
