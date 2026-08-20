import { IsBoolean, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateAnnouncementDTO {
    @IsString()
    @IsNotEmpty()
    textEn: string;

    @IsString()
    @IsNotEmpty()
    textAr: string;

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;
}

export class UpdateAnnouncementDTO {
    @IsString()
    @IsOptional()
    textEn?: string;

    @IsString()
    @IsOptional()
    textAr?: string;

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;
}
