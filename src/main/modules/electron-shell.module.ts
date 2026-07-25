import { Module } from '@nestjs/common';
import { ElectronShellService } from '../services/electron-shell.service';
import { SettingsModule } from './settings.module';

@Module({
  imports: [SettingsModule],
  providers: [ElectronShellService],
  exports: [ElectronShellService]
})
export class ElectronShellModule {}
