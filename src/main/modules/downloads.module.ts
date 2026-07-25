import { Module } from '@nestjs/common';
import { BinaryLocatorModule } from './binary-locator.module';
import { SettingsModule } from './settings.module';
import { DownloadsService } from '../services/downloads.service';

@Module({
  imports: [BinaryLocatorModule, SettingsModule],
  providers: [DownloadsService],
  exports: [DownloadsService]
})
export class DownloadsModule {}
