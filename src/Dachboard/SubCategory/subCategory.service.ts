import { ConflictException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { Request } from "express";
import { SubCategoryRepository } from "src/DB/models/SubCategory/subCategory.repository";
import { CreateDTO } from "./dto";
import { Types } from "mongoose";
import { CategoryRepository } from "src/DB/models/Category/category.repository";
import slugify from "slugify";
import { CloudService } from "src/common/service/cloud.service";

@Injectable()
export class SubCategoryService {
    constructor(
        private readonly subCategoryRepository: SubCategoryRepository,
        private readonly categoryRepository: CategoryRepository,
        private readonly cloudService: CloudService,
    ) { }


    async create(
        id: Types.ObjectId,
        body: CreateDTO,
        req: Request,
    ) {
        try {
            const { nameArabic, nameEnglish } = body
            const subCategory = await this.subCategoryRepository.findOne({ nameEnglish, nameArabic })
            if (subCategory) {
                throw new ConflictException("Sub category name already exist")
            }
            const category = await this.categoryRepository.findOne({ _id: id })
            if (!category) {
                throw new NotFoundException("Category not found")
            }
            const subCategoryCreated = await this.subCategoryRepository.create({
                nameArabic,
                nameEnglish,
                categoryId: id,
                image: {
                    secure_url: body.image?.secure_url ?? "",
                    public_id: body.image?.public_id ?? ""
                },
                createdBy: req["user"]._id as Types.ObjectId
            })
            await this.categoryRepository.updateOne(
                { _id: id },
                { $push: { subCategories: subCategoryCreated._id } })

            return subCategoryCreated
        } catch (error) {
            throw new InternalServerErrorException(error)
        }


    }


    async update(
        id: Types.ObjectId,
        body: CreateDTO,
        req: Request,
    ) {
        try {
            const { nameArabic, nameEnglish } = body
            const subCategory = await this.subCategoryRepository.findOne({ _id: id })
            if (!subCategory) {
                throw new NotFoundException("Sub category not found")
            }
            // Delete old image from disk if a new one was uploaded
            if (body.image?.public_id && subCategory.image?.public_id) {
                await this.cloudService.deleteFile(subCategory.image.public_id)
            }

            const subCategoryUpdated = await this.subCategoryRepository.updateOne({ _id: id }, {
                nameArabic,
                nameEnglish,
                ...(body.image ? {
                    image: {
                        secure_url: body.image.secure_url,
                        public_id: body.image.public_id
                    }
                } : {}),
                updatedBy: req["user"]._id as Types.ObjectId
            })

            return subCategoryUpdated
        } catch (error) {
            throw new InternalServerErrorException(error)
        }


    }

    async get(
    ) {
        try {
            const subCategories = await this.subCategoryRepository.findAll(
                { population: [{ path: 'categoryId createdBy' }] });
            return subCategories
        } catch (error) {
            throw new InternalServerErrorException(error)
        }


    }


    async delete(
        id: Types.ObjectId
    ) {
        try {
            const subCategory = await this.subCategoryRepository.findOne({ _id: id })
            if (!subCategory) {
                throw new NotFoundException("Sub category not found")
            }
            await this.categoryRepository.updateOne(
                { _id: subCategory.categoryId },
                { $pull: { subCategories: id } })


            if (subCategory.image?.public_id) {
                await this.cloudService.deleteFile(subCategory.image.public_id)
            }
            const subCategoryDeleted = await this.subCategoryRepository.deleteOne({ _id: id })

            return subCategoryDeleted
        } catch (error) {
            throw new InternalServerErrorException(error)
        }


    }
}