import assert from 'node:assert/strict';
// Edited blocks receive a persistent identity (src/extensions/block-identity.ts,
// commit bd68519): the editor writes ` id="ink-block-<uuid>"` into the opening
// tag of each block a user edit touched. Tests that compare stored bytes ignore
// exactly that attribute and nothing else: every other byte, every untouched
// block and every pre-existing id must still match.
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const GENERATED=new RegExp(`(<[a-zA-Z][a-zA-Z0-9]*(?:\\s[^<>]*?)?)\\sid="(ink-block-${UUID})"(?=[\\s/>])`,'g');
/** Generated block ids, in document order. */
export function blockIds(html:string):string[]{
 return Array.from(html.matchAll(GENERATED),match=>match[2]);
}
/** The stored bytes with only generated block-id attributes removed. */
export function withoutBlockIds(html:string):string{
 return html.replace(GENERATED,'$1');
}
/**
 * `actual` must equal `expected` byte for byte after removing generated
 * block-id attributes, and exactly `added` new ids (all unique, none already in
 * `expected`) may appear: edited blocks get one, untouched blocks none.
 * Pass `ids` to require the same identities as an earlier result (reload/redo).
 * Returns the new ids.
 */
export function assertBlockBytes(actual:string,expected:string,options:{added:number;ids?:string[];message?:string}):string[]{
 const message=options.message??'stored bytes';
 assert.equal(withoutBlockIds(actual),withoutBlockIds(expected),`${message}: bytes other than generated block ids`);
 const before=blockIds(expected),after=blockIds(actual);
 // Ids already present before the edit are kept, in place.
 for(const id of before)assert.ok(after.includes(id),`${message}: existing block id ${id} must be kept`);
 const added=after.filter(id=>!before.includes(id));
 assert.equal(added.length,options.added,`${message}: only edited blocks receive an identity (got ${added.length}: ${added.join(', ')})`);
 assert.equal(new Set(after).size,after.length,`${message}: block ids must be unique`);
 if(options.ids)assert.deepEqual(added,options.ids,`${message}: block identities must be stable`);
 return added;
}
