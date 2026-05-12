import { Global, Module } from '@nestjs/common';
import { AiRuntimeService } from './ai-runtime.service';

@Global()
@Module({
  providers: [AiRuntimeService],
  exports: [AiRuntimeService],
})
export class AiModule {}
