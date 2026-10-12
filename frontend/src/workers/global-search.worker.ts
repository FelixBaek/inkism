import {searchText} from '../lib/global-search-core';
self.onmessage=event=>{try{const {notes,texts,query,options}=event.data;self.postMessage({ok:true,result:searchText(notes,n=>texts[n.id]??n.preview,query,options)});}catch(e){self.postMessage({ok:false,error:e instanceof Error?e.message:String(e)});}};
