import { MongooseModule, Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, HydratedDocument } from "mongoose";

@Schema({ timestamps: true })
export class Announcement {
    @Prop({ type: String, required: true, trim: true })
    textEn: string;

    @Prop({ type: String, required: true, trim: true })
    textAr: string;

    @Prop({ type: Boolean, default: true })
    isActive: boolean;
}

export const announcementSchema = SchemaFactory.createForClass(Announcement);

export type typeAnnouncement = HydratedDocument<Announcement> & Document;

export const AnnouncementModel = MongooseModule.forFeature([{ name: Announcement.name, schema: announcementSchema }]);
