import { Module } from "@nestjs/common";
import { AnnouncementController } from "./announcement.controller";
import { AnnouncementService } from "./announcement.service";
import { AnnouncementModel } from "src/DB/models/Announcement/announcement.model";
import { AnnouncementRepository } from "src/DB/models/Announcement/announcement.repository";

@Module({
    imports: [AnnouncementModel],
    controllers: [AnnouncementController],
    providers: [AnnouncementService, AnnouncementRepository],
    exports: [AnnouncementService],
})
export class AnnouncementModule {}
