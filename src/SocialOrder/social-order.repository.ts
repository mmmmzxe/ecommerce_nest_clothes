import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DBService } from 'src/DB/db.service';
import { SocialOrder, TypeSocialOrder } from './social-order.model';

@Injectable()
export class SocialOrderRepository extends DBService<TypeSocialOrder> {
  constructor(
    @InjectModel(SocialOrder.name)
    private readonly socialOrderModel: Model<TypeSocialOrder>,
  ) {
    super(socialOrderModel);
  }

  async findByUserId(userId: Types.ObjectId): Promise<TypeSocialOrder[]> {
    return this.socialOrderModel
      .find({ createdByUserId: userId })
      .sort({ createdAt: -1 })
      .exec();
  }

  async countBySeller(): Promise<{ _id: string; count: number }[]> {
    return this.socialOrderModel.aggregate([
      { $group: { _id: '$createdBy', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
  }
}
