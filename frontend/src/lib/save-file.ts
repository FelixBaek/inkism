/** Desktop exports use the OS save picker; browser builds retain downloads. */
type SaveHost = {__inkismNativeSave?: boolean; __TAURI__?: {core?: {
  invoke: <T>(command: string, body: Uint8Array | Record<string,unknown>, options?: {headers: Record<string, string>}) => Promise<T>;
}}};
export async function saveFile(blob: Blob, name: string): Promise<boolean> {
  const host = globalThis as unknown as SaveHost;
  if (host.__inkismNativeSave) {
    const invoke = host.__TAURI__?.core?.invoke;
    if (!invoke) throw new Error('Native file saving is unavailable');
    return invoke<boolean>('save_export', new Uint8Array(await blob.arrayBuffer()), {
      headers: {'x-inkism-filename': encodeURIComponent(name)},
    });
  }
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Stream backups in the host/browser; never allocate the archive in JavaScript. */
export async function saveBackup(name:string):Promise<boolean>{
  const host=globalThis as unknown as SaveHost;
  if(host.__inkismNativeSave){
    const invoke=host.__TAURI__?.core?.invoke;
    if(!invoke)throw new Error('Native file saving is unavailable');
    return invoke<boolean>('save_backup',{name});
  }
  const link=document.createElement('a');link.href='/api/backup';link.download=name;
  document.body.appendChild(link);link.click();link.remove();return true;
}
