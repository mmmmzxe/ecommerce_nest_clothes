import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AnnouncementRepository } from "src/DB/models/Announcement/announcement.repository";
import { CreateAnnouncementDTO, UpdateAnnouncementDTO } from "./DTO";

@Injectable()
export class AnnouncementService {
    constructor(private readonly announcementRepository: AnnouncementRepository) {}

    async create(dto: CreateAnnouncementDTO) {
        return await this.announcementRepository.create(dto);
    }

    async getAll() {
        return await this.announcementRepository.findAll({ filter: {} });
    }

    async getActive() {
        return await this.announcementRepository.findAll({ filter: { isActive: true } });
    }

    async update(id: string, dto: UpdateAnnouncementDTO) {
        const item = await this.announcementRepository.findOne({ _id: id });
        if (!item) {
            throw new NotFoundException("Announcement not found");
        }
        await this.announcementRepository.updateOne({ _id: id }, dto);
        return await this.announcementRepository.findOne({ _id: id });
    }

    async delete(id: string) {
        const item = await this.announcementRepository.findOne({ _id: id });
        if (!item) {
            throw new NotFoundException("Announcement not found");
        }
        return await this.announcementRepository.deleteOne({ _id: id });
    }
}
