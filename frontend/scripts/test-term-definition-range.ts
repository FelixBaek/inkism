import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { termDefinitionRange } from '../src/lib/term-definition-range.ts';
const schema=new Schema({nodes:{doc:{content:'paragraph+'},paragraph:{content:'text*'},text:{}},marks:{termDefinition:{attrs:{id:{},definition:{}}},strong:{}}});
const mark=schema.marks.termDefinition.create({id:'duplicate',definition:'meaning'});
const paragraph=schema.nodes.paragraph.create(null,[schema.text('one',[mark]),schema.text(' untouched '),schema.text('two',[mark])]);
const doc=schema.nodes.doc.create(null,[paragraph]);
test('first and second duplicate IDs never merge across unmarked text',()=>{
 const first=termDefinitionRange(doc,1,'duplicate');
 const second=termDefinitionRange(doc,15,'duplicate');
 assert.equal(first?.from,1);assert.equal(first?.to,4);
 assert.equal(second?.from,15);assert.equal(second?.to,18);
 assert.equal(termDefinitionRange(doc,8,'duplicate'),undefined);
});
test('formatting splits inside one occurrence retain its contiguous range',()=>{
 const mixed=schema.nodes.doc.create(null,[schema.nodes.paragraph.create(null,[schema.text('a',[mark]),schema.text('b',[mark,schema.marks.strong.create()])])]);
 const found=termDefinitionRange(mixed,2,'duplicate');
 assert.equal(found?.from,1);assert.equal(found?.to,3);
});
