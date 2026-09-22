import { Module } from '@nestjs/common';
import { OrderTrackingLinkController, PublicTrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Module({
  controllers: [PublicTrackingController, OrderTrackingLinkController],
  providers: [TrackingService],
})
export class TrackingModule {}
