import { Module } from '@nestjs/common';
import { AgentApiModule } from './modules/agent-api.module';
import { ApplicationUpdaterModule } from './modules/application-updater.module';
import { BinaryLocatorModule } from './modules/binary-locator.module';
import { DownloadsModule } from './modules/downloads.module';
import { ElectronShellModule } from './modules/electron-shell.module';
import { SettingsModule } from './modules/settings.module';

@Module({
  imports: [
    AgentApiModule,
    ApplicationUpdaterModule,
    BinaryLocatorModule,
    DownloadsModule,
    ElectronShellModule,
    SettingsModule
  ]
})
export class AppModule {}
