import 'reflect-metadata';
import { createRequire } from 'node:module';
import { ElectronApplication } from './electron-application';

const require = createRequire(import.meta.url);
const { app } = require('electron') as typeof import('electron');

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  const application = new ElectronApplication();

  app.on('second-instance', (_event, commandLine) => {
    if (!commandLine.includes('--headless')) {
      application.showOrCreateWindow();
    }
  });

  void app.whenReady().then(() => application.start());
}
