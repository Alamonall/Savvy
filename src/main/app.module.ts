import { Module } from '@nestjs/common';
import { BinaryLocatorModule } from './modules/binary-locator.module';
import { DownloadsModule } from './modules/downloads.module';
import { ElectronShellModule } from './modules/electron-shell.module';
import { SettingsModule } from './modules/settings.module';

@Module({
  imports: [BinaryLocatorModule, DownloadsModule, ElectronShellModule, SettingsModule]
})
export class AppModule {}
