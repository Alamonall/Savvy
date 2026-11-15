import { Module } from '@nestjs/common';
import { AgentApiService } from '../services/agent-api.service';
import { DownloadsModule } from './downloads.module';
import { SettingsModule } from './settings.module';

@Module({
  imports: [DownloadsModule, SettingsModule],
  providers: [AgentApiService],
  exports: [AgentApiService]
})
export class AgentApiModule {}
