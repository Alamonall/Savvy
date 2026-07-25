import 'reflect-metadata';
import { createRequire } from 'node:module';
import { ElectronApplication } from './electron-application';

const require = createRequire(import.meta.url);
const { app } = require('electron') as typeof import('electron');

void app.whenReady().then(() => new ElectronApplication().start());
