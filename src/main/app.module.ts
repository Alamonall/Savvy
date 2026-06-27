import { Module } from '@nestjs/common';
import { BinaryLocatorService } from './services/binary-locator.service';
import { DownloadsService } from './services/downloads.service';
import { ElectronShellService } from './services/electron-shell.service';
import { SettingsService } from './services/settings.service';

@Module({
  providers: [BinaryLocatorService, DownloadsService, ElectronShellService, SettingsService],
  exports: [BinaryLocatorService, DownloadsService, ElectronShellService, SettingsService]
})
export class AppModule {}
