import { Module } from '@nestjs/common';
import { BinaryLocatorService } from '../services/binary-locator.service';

@Module({
  providers: [BinaryLocatorService],
  exports: [BinaryLocatorService]
})
export class BinaryLocatorModule {}
