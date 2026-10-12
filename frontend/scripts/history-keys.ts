// The editor toolbar has no undo/redo buttons since the Figma redesign; history
// is driven by the editor's own shortcuts (Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z).
// Keys only reach the history handler from inside the editor, so focus the
// editor that already has focus, or else the first one, without moving its selection.
export async function historyKey(page,direction){
  await page.evaluate(()=>{
    if(document.activeElement?.closest?.('.tiptap-prose'))return;
    document.querySelector<any>('.tiptap-prose')?.editor?.view.focus();
  });
  await page.keyboard.press(direction==='redo'?'Control+y':'Control+z');
}
