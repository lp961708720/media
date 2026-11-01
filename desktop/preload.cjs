const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('mediaStudioClipboard',{write:payload=>ipcRenderer.invoke('media-studio:write-clipboard',payload)});
