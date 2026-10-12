//! Conservative three-way merge of independently edited top-level HTML blocks.
//! This is not a CRDT: structural and overlapping changes remain explicit conflicts.
use crate::sanitize;
use scraper::{ElementRef,Html,Node};

pub fn scalar(base:&str,current:&str,submitted:&str)->Result<String,&'static str>{
    if current==submitted || base==submitted {Ok(current.to_owned())}
    else if base==current {Ok(submitted.to_owned())}
    else {Err("overlapping edit")}
}
fn blocks(source:&str)->Result<Vec<(String,String)>, &'static str>{
    let document=Html::parse_fragment(source);
    let mut out=Vec::new();
    for child in document.root_element().children(){
        match child.value(){
            Node::Text(text) if text.trim().is_empty()=>out.push(("whitespace".into(),text.to_string())),
            Node::Element(element) if ["p","h1","h2","h3","h4","h5","h6","blockquote","pre","ul","ol","table","hr"].contains(&element.name())=>{
                let html=ElementRef::wrap(child).ok_or("invalid block")?.html();
                let canonical=sanitize::clean(&html).map_err(|_|"invalid block")?;
                out.push((element.name().to_owned(),canonical));
            },
            _=>return Err("unsupported top-level structure"),
        }
        if out.len()>10000{return Err("too many blocks");}
    }
    // Parsing/serialization must not silently repair or drop any canonical data.
    if out.iter().map(|(_,html)|html.as_str()).collect::<String>()!=source{return Err("noncanonical block boundaries");}
    Ok(out)
}
pub fn html(base:&str,current:&str,submitted:&str)->Result<String,&'static str>{
    if let Ok(merged)=scalar(base,current,submitted){return Ok(merged);}
    let(base,current,submitted)=(blocks(base)?,blocks(current)?,blocks(submitted)?);
    if base.len()!=current.len()||base.len()!=submitted.len(){return Err("structural edit conflict");}
    let mut merged=String::new();
    for ((b,c),s) in base.iter().zip(&current).zip(&submitted){
        if b.0!=c.0||b.0!=s.0{return Err("block type conflict");}
        merged.push_str(&scalar(&b.1,&c.1,&s.1)?);
        if merged.len()>sanitize::MAX_BYTES{return Err("merged HTML too large");}
    }
    if sanitize::clean(&merged).map_err(|_|"invalid merged HTML")?!=merged{return Err("merged structure changed");}
    Ok(merged)
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn independent_blocks_and_unicode(){
  assert_eq!(html("<p>하나🙂</p><p>둘</p>","<p><strong>첫째🙂</strong></p><p>둘</p>","<p>하나🙂</p><p>두 번째</p>").unwrap(),"<p><strong>첫째🙂</strong></p><p>두 번째</p>");
  assert_eq!(html("<p>A</p>\n<p>B</p>","<p>A1</p>\n<p>B</p>","<p>A</p>\n<p>B1</p>").unwrap(),"<p>A1</p>\n<p>B1</p>");
 }
 #[test]fn overlapping_and_structural_changes_conflict(){
  for (base,current,submitted) in [("<p>A</p>","<p>AB</p>","<p>AC</p>"),("<p>A</p><p>B</p>","<p>A1</p><p>B</p>","<p>A</p><p>B</p><p>C</p>"),("<p>A</p><p>B</p>","<h1>A</h1><p>B</p>","<p>A</p><p>B1</p>"),("<strong>A</strong><p>B</p>","<strong>A1</strong><p>B</p>","<strong>A</strong><p>B1</p>")]{assert!(html(base,current,submitted).is_err());}
  assert!(scalar("Title","A title","B title").is_err());
 }
}
