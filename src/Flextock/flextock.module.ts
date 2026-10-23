import { Module } from '@nestjs/common';
import { FlextockService } from './flextock.service';

@Module({
  providers: [FlextockService],
  exports: [FlextockService],
})
export class FlextockModule {}
