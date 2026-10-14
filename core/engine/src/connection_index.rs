//! Derived reference details, prepared only by the background index worker.
use serde_json::{json,Value};
fn wiki(text:&str,out:&mut Vec<Value>){let mut at=0;while let Some(found)=text[at..].find("[["){let start=at+found;let Some(end)=text[start+2..].find("]]")else{break};let value=&text[start+2..start+2+end];if !value.contains('\n')&&value.len()<=8192{let (target,label)=value.split_once('|').unwrap_or((value,value));out.push(json!({"reference":target.trim(),"label":label.trim(),"embed":start>0&&text.as_bytes()[start-1]==b'!'}));}at=start+end+4;}}
pub fn references(source:&str,format:&str)->Vec<Value>{
 let mut out=Vec::new();
 if format=="html"{let doc=scraper::Html::parse_fragment(source);for node in doc.root_element().descendants(){if node.ancestors().any(|n|n.value().as_element().is_some_and(|el|["code","pre","script","style","textarea","template"].contains(&el.name()))){continue;}
  if let Some(value)=node.value().as_text(){wiki(value,&mut out);}
  if let Some(el)=node.value().as_element(){if el.name()=="a"{if let Some(href)=el.attr("href").filter(|v|v.starts_with("note://")){if let Some(element)=scraper::ElementRef::wrap(node){let label=element.text().collect::<String>();if href.len()<=8192&&label.len()<=4096{out.push(json!({"reference":href,"label":label,"embed":false}));}}}}}
 }}else if format=="markdown"{
  use pulldown_cmark::{Event,Parser,Tag,TagEnd};let mut active:Option<(String,String,bool)>=None;let mut hidden:Option<&str>=None;
  for (event,range) in Parser::new_ext(source,pulldown_cmark::Options::all()).into_offset_iter(){
   if let Event::Html(value)|Event::InlineHtml(value)=&event{let lower=value.to_ascii_lowercase();if let Some(tag)=hidden{if lower.contains(&format!("</{tag}")){hidden=None;}continue;}hidden=["code","pre","script","style","textarea","template"].into_iter().find(|tag|lower.trim_start().strip_prefix(&format!("<{tag}")).is_some_and(|s|s.starts_with('>')||s.starts_with(char::is_whitespace))&&!lower.contains(&format!("</{tag}")));}
   if hidden.is_some(){continue;}
   match event{Event::Start(Tag::Link{dest_url,link_type,..})|Event::Start(Tag::Image{dest_url,link_type,..})=>{if dest_url.starts_with("note://")||matches!(link_type,pulldown_cmark::LinkType::WikiLink{..}){let embed=source[range.clone()].starts_with("!");active=Some((dest_url.to_string(),String::new(),embed));}},Event::Text(text)|Event::Code(text)=>{if let Some((_,label,_))=&mut active{if label.len()+text.len()<=4096{label.push_str(&text);}else{active=None;}}},Event::End(TagEnd::Link)|Event::End(TagEnd::Image)=>{if let Some((target,label,embed))=active.take(){if target.len()<=8192{out.push(json!({"reference":target,"label":label,"embed":embed}));}}},_=>{}}
  }
 }
 out
}

use crate::error::{EngineError,Result};
use rusqlite::{Connection,OptionalExtension,params};
fn checked<'a>(conn:&'a Connection,args:&Value)->Result<(rusqlite::Transaction<'a>,String,bool)>{
 let id=args["id"].as_str().filter(|id|crate::ids::valid_id(id)).ok_or_else(||EngineError::invalid("bad id"))?.to_owned();let revision=args["revision"].as_i64().ok_or_else(||EngineError::invalid("missing revision"))?;let tx=conn.unchecked_transaction()?;
 let actual:Option<i64>=tx.query_row("SELECT revision FROM notes_meta WHERE id=?1 AND trashed=0 AND locked=0",[&id],|r|r.get(0)).optional()?;if actual!=Some(revision){return Err(EngineError::Conflict("document revision changed or unavailable".into()));}
 let pending:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM index_jobs WHERE note_id=?1)",[&id],|r|r.get(0))?;Ok((tx,id,!pending))
}
pub fn outgoing(conn:&Connection,args:&Value)->Result<Value>{
 let(tx,id,ready)=checked(conn,args)?;if !ready{return Ok(json!({"ready":false,"items":[],"next_cursor":null}));}
 let after=args.get("cursor").filter(|v|!v.is_null()).map(|v|v.as_str().and_then(|s|s.parse::<i64>().ok()).filter(|v|*v>=0).ok_or_else(||EngineError::invalid("bad reference cursor"))).transpose()?.unwrap_or(-1);
 let mut stmt=tx.prepare("SELECT ordinal,reference,label,embed FROM searchidx.outgoing_references WHERE source_id=?1 AND ordinal>?2 ORDER BY ordinal LIMIT 21")?;
 let mut items=stmt.query_map(params![id,after],|r|Ok(json!({"ordinal":r.get::<_,i64>(0)?,"reference":r.get::<_,String>(1)?,"label":r.get::<_,String>(2)?,"embed":r.get::<_,bool>(3)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
 let next=if items.len()>20{items.truncate(20);Some(items[19]["ordinal"].as_i64().unwrap().to_string())}else{None};Ok(json!({"ready":true,"items":items,"next_cursor":next}))
}
/// Scan at most 100 metadata candidates per call. SQL examines the derived text;
/// neither a canonical body nor the indexed text is returned or copied into Rust.
pub fn mentions(conn:&Connection,args:&Value)->Result<Value>{
 let(tx,id,ready)=checked(conn,args)?;if !ready{return Ok(json!({"ready":false,"items":[],"next_cursor":null}));}
 let after=args.get("cursor").and_then(Value::as_str).unwrap_or("");if !after.is_empty()&&!crate::ids::valid_id(after){return Err(EngineError::invalid("bad mention cursor"));}
 let mut metadata=tx.prepare("SELECT id,title FROM notes_meta WHERE id>?2 AND id!=?1 AND trashed=0 AND locked=0 AND length(trim(title))>=2 ORDER BY id LIMIT 100")?;
 let candidates=metadata.query_map(params![id,after],|r|{let title:String=r.get(1)?;Ok(json!({"id":r.get::<_,String>(0)?,"title":title,"folded":title.trim().to_lowercase()}))})?.collect::<std::result::Result<Vec<_>,_>>()?;
 let next=if candidates.len()==100{Some(candidates[99]["id"].clone())}else{None};
 let mut stmt=tx.prepare("SELECT json_extract(c.value,'$.id'),json_extract(c.value,'$.title') FROM json_each(?2) c,searchidx.connection_text source WHERE source.source_id=?1 AND instr(source.folded,json_extract(c.value,'$.folded'))>0 AND NOT EXISTS(SELECT 1 FROM searchidx.backlinks b WHERE b.source_id=?1 AND b.target_id=json_extract(c.value,'$.id')) AND NOT EXISTS(SELECT 1 FROM searchidx.backlink_titles b WHERE b.source_id=?1 AND (b.target_title=json_extract(c.value,'$.title') COLLATE NOCASE OR b.target_title COLLATE NOCASE IN (SELECT a.value FROM settings s,json_each(s.value,'$.aliases') a WHERE s.key='knowledge_note:'||json_extract(c.value,'$.id')))) ORDER BY json_extract(c.value,'$.id')")?;
 let items=stmt.query_map(params![id,serde_json::to_string(&candidates).unwrap()],|r|Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
 Ok(json!({"ready":true,"items":items,"next_cursor":next}))
}

/// Bounded HTML candidates for a heading/block reference. Oversized blocks carry
/// metadata only; callers request existing 32 KiB segments instead of full HTML.
pub fn candidates(conn:&Connection,args:&Value)->Result<Value>{
 let(tx,id,ready)=checked(conn,args)?;let query=args["query"].as_str().filter(|s|!s.is_empty()&&s.len()<=4096).ok_or_else(||EngineError::invalid("bad anchor query"))?;let after=args.get("after").and_then(Value::as_i64).unwrap_or(-1);
 if !ready{return Ok(json!({"ready":false,"items":[],"next":null}));}
 let cached:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM searchidx.document_layout c JOIN notes_meta m ON m.id=c.note_id AND m.revision=c.revision WHERE c.note_id=?1)",[&id],|r|r.get(0))?;if !cached{return Ok(json!({"ready":false,"items":[],"next":null}));}
 let needle=query.trim_start_matches('^');let words=needle.replace('-'," ");
 let mut stmt=tx.prepare("SELECT ordinal,byte_offset,CASE WHEN length(CAST(html AS BLOB))<=65536 THEN html ELSE NULL END FROM searchidx.document_blocks WHERE note_id=?1 AND ordinal>?2 AND (instr(lower(html),lower(?3))>0 OR instr(lower(search_text),lower(?4))>0) ORDER BY ordinal LIMIT 17")?;
 let mut items=stmt.query_map(params![id,after,needle,words],|r|Ok(json!({"ordinal":r.get::<_,i64>(0)?,"byte_offset":r.get::<_,i64>(1)?,"html":r.get::<_,Option<String>>(2)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;let next=if items.len()>16{items.truncate(16);Some(items[15]["ordinal"].as_i64().unwrap())}else{None};Ok(json!({"ready":true,"items":items,"next":next}))
}

pub fn markdown_previews(source:&str)->Vec<Value>{
 use pulldown_cmark::{Event,Parser,Tag,TagEnd};
 let mut headings:Vec<(String,usize,u8)>=Vec::new();let mut current:Option<(String,usize,u8)>=None;let mut blocks=Vec::new();
 for(event,range)in Parser::new_ext(source,pulldown_cmark::Options::all()).into_offset_iter(){match event{
  Event::Start(Tag::Heading{level,..})=>current=Some((String::new(),range.start,level as u8)),
  Event::Text(value)|Event::Code(value)=>if let Some((name,_,_))=&mut current{if name.len()+value.len()<=4096{name.push_str(&value);}else{current=None;}},
  Event::End(TagEnd::Heading(_))=>if let Some(value)=current.take(){headings.push(value);},
  Event::Start(Tag::Paragraph)=>{let raw=source[range.clone()].trim_end();if let Some(token)=raw.split_whitespace().last(){if let Some(id)=token.strip_prefix('^').filter(|id|!id.is_empty()&&id.len()<=1024&&id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-')){blocks.push((id.to_owned(),range.start,range.end));}}},_=>{}
 }}
 let slice=|start:usize,end:usize|{let mut stop=end.min(start+65536);while !source.is_char_boundary(stop){stop-=1;}(&source[start..stop],stop<end)};
 let (whole,truncated)=slice(0,source.len());let mut items=vec![json!({"anchor":"","kind":"whole","byte_offset":0,"source":whole,"label":"","truncated":truncated})];
 for(i,(name,start,level))in headings.iter().enumerate(){let end=headings[i+1..].iter().find(|(_,_,next)|next<=level).map(|(_,start,_)|*start).unwrap_or(source.len());let(raw,truncated)=slice(*start,end);let slug=name.to_lowercase().split_whitespace().collect::<Vec<_>>().join("-");for key in [name.to_lowercase(),slug]{items.push(json!({"anchor":key,"kind":"heading","byte_offset":start,"source":raw,"label":name,"truncated":truncated}));}}
 for(id,start,end)in blocks{let(raw,truncated)=slice(start,end);items.push(json!({"anchor":id,"kind":"block","byte_offset":start,"source":raw,"label":"","truncated":truncated}));}items
}
pub fn preview(conn:&Connection,args:&Value)->Result<Value>{
 let(tx,id,ready)=checked(conn,args)?;if !ready{return Ok(json!({"ready":false,"item":null}));}let anchor=args.get("anchor").and_then(Value::as_str).unwrap_or("");if anchor.len()>4096{return Err(EngineError::invalid("anchor too long"));}let normalized=anchor.trim_start_matches('^');
 let item:Option<Value>=tx.query_row("SELECT kind,byte_offset,source,label,truncated FROM searchidx.reference_previews WHERE source_id=?1 AND ((kind!='heading' AND anchor=?2) OR (kind='heading' AND anchor=?3)) ORDER BY CASE kind WHEN 'block' THEN 0 ELSE 1 END LIMIT 1",params![id,normalized,normalized.to_lowercase()],|r|Ok(json!({"kind":r.get::<_,String>(0)?,"byte_offset":r.get::<_,i64>(1)?,"source":r.get::<_,String>(2)?,"label":r.get::<_,String>(3)?,"truncated":r.get::<_,bool>(4)?}))).optional()?;Ok(json!({"ready":true,"item":item}))
}
