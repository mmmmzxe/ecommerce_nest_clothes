import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, UsePipes, ValidationPipe } from "@nestjs/common";
import { AnnouncementService } from "./announcement.service";
import { CreateAnnouncementDTO, UpdateAnnouncementDTO } from "./DTO";
import { Public } from "src/common/Decorator/public.decorator";
import { AuthGuard } from "src/common/Guards/auth.guard";
import { RoleGuard } from "src/common/Guards/role.guard";
import { Role } from "src/common/Decorator/role.decorator";

@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(AuthGuard, RoleGuard)
@Controller("announcement")
export class AnnouncementController {
    constructor(private readonly announcementService: AnnouncementService) {}

    @Role(["superAdmin", "admin"])
    @Post()
    async create(@Body() dto: CreateAnnouncementDTO) {
        const announcement = await this.announcementService.create(dto);
        return { announcement };
    }

    @Public("public")
    @Get()
    async getAll() {
        const announcements = await this.announcementService.getAll();
        return { announcements };
    }

    @Public("public")
    @Get("active")
    async getActive() {
        const announcements = await this.announcementService.getActive();
        return { announcements };
    }

    @Role(["superAdmin", "admin"])
    @Patch(":id")
    async update(@Param("id") id: string, @Body() dto: UpdateAnnouncementDTO) {
        const announcement = await this.announcementService.update(id, dto);
        return { announcement };
    }

    @Role(["superAdmin", "admin"])
    @Delete(":id")
    async delete(@Param("id") id: string) {
        const result = await this.announcementService.delete(id);
        return { result };
    }
}
