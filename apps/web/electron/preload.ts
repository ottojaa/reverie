import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Add IPC methods here as needed
  platform: process.platform,
  
  // Example IPC communication methods
  send: (channel: string, data: unknown) => {
    const validChannels = ['upload-file', 'open-folder'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    const validChannels = ['file-uploaded', 'folder-opened'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => func(...args));
    }
  },
});


