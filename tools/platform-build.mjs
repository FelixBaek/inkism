/** Manual/CI native artifact build; never publishes or signs a production release. */
import {spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const shellRoot=path.join(root,'desktop-tauri');
const target=process.argv[2];
const allowed=['windows','macos','android','ios'];
if(!allowed.includes(target))throw new Error('Usage: node tools/platform-build.mjs windows|macos|android|ios');
function run(command,args,cwd=root,extra={}) {
 const result=spawnSync(command,args,{cwd,stdio:'inherit',env:{...process.env,...extra},shell:process.platform==='win32'});
 if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} exited ${result.status}`);
}
function tauri(args){run(process.platform==='win32'?'npm.cmd':'npm',['run','tauri','--',...args],shellRoot);}
if(!existsSync(path.join(root,'frontend/dist/index.html')))throw new Error('Build frontend first: npm --prefix frontend ci && npm --prefix frontend run build');
if(target==='android'||target==='ios') {
 if(target==='ios'&&process.platform!=='darwin')throw new Error('iOS builds require macOS and Xcode');
 tauri(['icon','src-tauri/icons/icon.png']);
 tauri([target,'init','--ci','--skip-targets-install','--config','src-tauri/tauri.mobile.conf.json']);
 if(target==='android') {
  const manifest=path.join(shellRoot,'src-tauri/gen/android/app/src/main/AndroidManifest.xml');
  let xml=readFileSync(manifest,'utf8');
  // A restored sandbox cannot restore the device-bound AndroidKeyStore key.
  // Use Inkism export/sync for device migration instead of a broken OS restore.
  xml=xml.replace(/\sandroid:allowBackup="[^"]*"/g,'').replace('<application','<application android:allowBackup="false"');
  for(const permission of ['android.permission.RECORD_AUDIO','android.permission.CAMERA']) {
   if(!xml.includes(`android:name="${permission}"`))xml=xml.replace('<application',`<uses-permission android:name="${permission}" />\n    <application`);
  }
  xml=xml.replace(/\sandroid:(?:dataExtractionRules|fullBackupContent)="[^"]*"/g,'').replace('<application','<application android:dataExtractionRules="@xml/inkism_data_extraction_rules" android:fullBackupContent="@xml/inkism_backup_rules"');
  const xmlDir=path.join(path.dirname(manifest),'res/xml');
  mkdirSync(xmlDir,{recursive:true});
  copyFileSync(path.join(shellRoot,'installer/android/data-extraction-rules.xml'),path.join(xmlDir,'inkism_data_extraction_rules.xml'));
  copyFileSync(path.join(shellRoot,'installer/android/backup-rules.xml'),path.join(xmlDir,'inkism_backup_rules.xml'));
  writeFileSync(manifest,xml);
 }
 if(target==='android')tauri(['android','build' ,'--ci','--debug','--target','aarch64','--apk','--config','src-tauri/tauri.mobile.conf.json']);
 else tauri(['ios','build','--ci','--debug','--target',process.arch==='arm64'?'aarch64-sim':'x86_64','--config','src-tauri/tauri.mobile.conf.json']);
} else {
 if((target==='windows')!==(process.platform==='win32')||(target==='macos'&&process.platform!=='darwin'))throw new Error('Use the matching Windows/macOS native build runner');
 const host=spawnSync('rustc',['-vV'],{encoding:'utf8'}).stdout?.match(/^host: (.+)$/m)?.[1];
 if(!host)throw new Error('Rust host target is unavailable');
 const runtimeArgs=['build','--locked','--release','--target',host,'--manifest-path','core/runtime-core/Cargo.toml'];
 // Keep Windows' existing user-bound SQLCipher provisioning policy.
 if(target==='windows')runtimeArgs.push('--features','encrypted-storage');
 run('cargo',runtimeArgs);
 const extension=target==='windows'?'.exe':'';
 const cargoTarget=process.env.CARGO_TARGET_DIR?path.resolve(root,process.env.CARGO_TARGET_DIR):path.join(root,'core/runtime-core/target');
 const binaryDir=path.join(shellRoot,'src-tauri/binaries');mkdirSync(binaryDir,{recursive:true});
 copyFileSync(path.join(cargoTarget,host,'release','inkism-engine'+extension),path.join(binaryDir,`inkism-engine-${host}${extension}`));
 tauri(['icon','src-tauri/icons/icon.png']);
 tauri(['build','--ci','--no-sign','--target',host,'--bundles',target==='windows'?'nsis':'dmg','--config','src-tauri/tauri.desktop.conf.json']);
}
