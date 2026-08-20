import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { DBService } from "src/DB/db.service";
import { Announcement, typeAnnouncement } from "./announcement.model";

@Injectable()
export class AnnouncementRepository extends DBService<typeAnnouncement> {
    constructor(@InjectModel(Announcement.name) private readonly announcementModel: Model<typeAnnouncement>) {
        super(announcementModel);
    }
}
