import { Module } from '@nestjs/common';
import { BinaryLocatorModule } from './binary-locator.module';
import { SettingsService } from '../services/settings.service';

@Module({
  imports: [BinaryLocatorModule],
  providers: [SettingsService],
  exports: [SettingsService]
})
export class SettingsModule {}
