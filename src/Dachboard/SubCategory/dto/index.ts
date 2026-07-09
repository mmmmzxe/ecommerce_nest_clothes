import { IsMongoId, IsNotEmpty, IsObject, IsOptional, IsString, MinLength } from "class-validator"
import { Types } from "mongoose"
import { IImage } from "src/DB/models/Category/category.model"

export class CreateDTO {
    @IsString()
    @IsNotEmpty()
    @MinLength(3)
    nameArabic: string

    @IsString()
    @IsNotEmpty()
    @MinLength(3)
    nameEnglish: string

    @IsObject()
    @IsOptional()
    image?: IImage

    @IsMongoId()
    categoryId: Types.ObjectId
}