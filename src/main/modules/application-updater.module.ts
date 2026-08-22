import { Module } from '@nestjs/common';
import { ApplicationUpdaterService } from '../services/application-updater.service';
import { DownloadsModule } from './downloads.module';

/** Собирает зависимости процесса обновления приложения. */
@Module({
  imports: [DownloadsModule],
  providers: [ApplicationUpdaterService],
  exports: [ApplicationUpdaterService]
})
export class ApplicationUpdaterModule {}
