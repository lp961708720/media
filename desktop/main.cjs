const {app,BrowserWindow,Menu,shell,safeStorage,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto');
app.setName('Media Studio');if(process.env.MEDIA_STUDIO_DATA_DIR){app.setPath('userData',path.resolve(process.env.MEDIA_STUDIO_DATA_DIR));}let backend,win,closing=false;
const single=app.requestSingleInstanceLock();if(!single)app.quit();
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus()}});
async function getKey(dir){const file=path.join(dir,'vault-key.enc');
if(typeof safeStorage.isAsyncEncryptionAvailable==='function'){
const available=await safeStorage.isAsyncEncryptionAvailable();if(!available)throw new Error('系统安全存储暂不可用，请解锁系统钥匙串后重试。');
if(fs.existsSync(file)){const result=await safeStorage.decryptStringAsync(fs.readFileSync(file));return typeof result==='string'?result:result.result}
const key=randomBytes(32).toString('base64'),result=await safeStorage.encryptStringAsync(key);fs.writeFileSync(file,Buffer.isBuffer(result)?result:result.encryptedData||result.ciphertext,{mode:0o600});return key;
}
if(!safeStorage.isEncryptionAvailable())throw new Error('系统安全存储不可用');if(fs.existsSync(file))return safeStorage.decryptString(fs.readFileSync(file));const key=randomBytes(32).toString('base64');fs.writeFileSync(file,safeStorage.encryptString(key),{mode:0o600});return key;
}
async function createWindow(){win=new BrowserWindow({width:1480,height:960,minWidth:800,minHeight:600,title:'Media Studio · 自媒体工作台',backgroundColor:'#f7f8fa',autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});const session=win.webContents.session;session.setPermissionRequestHandler((wc,permission,callback)=>callback(false));await session.cookies.set({url:backend.origin,name:'ms_session',value:backend.token,httpOnly:true,sameSite:'strict'});
win.webContents.setWindowOpenHandler(({url})=>{try{const parsed=new URL(url);if(['https:','http:'].includes(parsed.protocol)&&parsed.origin!==backend.origin)shell.openExternal(url)}catch{}return {action:'deny'}});
win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==backend.origin)event.preventDefault()});win.webContents.on('will-attach-webview',event=>event.preventDefault());
session.on('will-download',(event,item)=>{item.setSaveDialogOptions({title:'导出文件',defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()))})});
win.on('close',event=>{if(closing)return;event.preventDefault();win.webContents.executeJavaScript('typeof flush === "function" ? flush().then(()=>true).catch(()=>false) : true').then(ok=>{if(ok){closing=true;win.close()}else{dialog.showMessageBox(win,{type:'warning',title:'稿件尚未保存',message:'保存失败，请先保留或合并未保存内容，再关闭窗口。',buttons:['继续编辑']})}}).catch(()=>{closing=true;win.close()})});
win.on('closed',()=>{win=null});await win.loadURL(backend.origin);
}
if(single)app.whenReady().then(async()=>{try{const dir=app.getPath('userData');fs.mkdirSync(dir,{recursive:true});const key=await getKey(dir);if(!key)throw new Error('系统凭证密钥无法读取');const {startServer}=await import('../scripts/server.mjs');backend=await startServer({dataDir:dir,key});Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Media Studio',submenu:[{role:'about'},{type:'separator'},{label:'打开数据目录',click:()=>shell.openPath(dir)},{type:'separator'},{role:'quit'}]},{label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'显示',submenu:[{role:'reload'},{role:'togglefullscreen'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]}]));await createWindow()}catch(e){dialog.showErrorBox('Media Studio 无法启动',e.message);app.quit()}});
app.on('activate',()=>{if(!win&&backend){closing=false;createWindow()}});app.on('window-all-closed',()=>app.quit());app.on('will-quit',()=>{if(backend){backend.server.closeAllConnections();backend.server.close();}});
