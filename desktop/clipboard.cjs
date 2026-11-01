// A write-only bridge, restricted to our own main window and local origin.
module.exports=function installClipboardBridge({ipcMain,clipboard,getWindow,getOrigin}){
 ipcMain.handle('media-studio:write-clipboard',(event,payload)=>{
  const win=getWindow();let trusted=false;try{trusted=!!win&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&new URL(event.senderFrame.url).origin===getOrigin();}catch{}
  if(!trusted)throw new Error('剪贴板请求来源无效');if(!payload||typeof payload.text!=='string'||(payload.html!==undefined&&typeof payload.html!=='string'))throw new Error('剪贴板格式无效');
  clipboard.write({text:payload.text,...(payload.html?{html:payload.html}:{})});return {ok:true};
 });
};
