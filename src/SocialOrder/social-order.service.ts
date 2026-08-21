import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { TypeUser } from 'src/DB/models/User/user.model';
import { CloudService } from 'src/common/service/cloud.service';
import { emailEvent } from 'src/common/Utility/email.event';
import { CreateSocialOrderDto } from './dto/create-social-order.dto';
import { SocialOrderRepository } from './social-order.repository';
import { TypeSocialOrder } from './social-order.model';

const SELLER_NAMES = ['Fatma', 'Mariam', 'Zeinab', 'Sara'] as const;

@Injectable()
export class SocialOrderService {
  constructor(
    private readonly socialOrderRepository: SocialOrderRepository,
    private readonly cloudService: CloudService,
  ) {}

  async create(
    dto: CreateSocialOrderDto,
    user: TypeUser,
    file?: Express.Multer.File,
  ): Promise<TypeSocialOrder> {
    try {
      // Admins can only create orders under their own name.
      // SuperAdmin can use any seller name.
      if (user.role === 'admin') {
        const sellerMatch = SELLER_NAMES.find(
          (name) => name.toLowerCase() === user.name.toLowerCase(),
        );
        if (!sellerMatch || sellerMatch !== dto.createdBy) {
          throw new ForbiddenException(
            'You can only create orders under your own name.',
          );
        }
      }

      let productImage: { secure_url: string; public_id: string } | undefined;
      if (file) {
        const uploaded = await this.cloudService.uploadFile({ path: file.path });
        productImage = {
          secure_url: uploaded.secure_url,
          public_id: uploaded.public_id,
        };
      }

      const order = await this.socialOrderRepository.create({
        ...dto,
        createdByUserId: new Types.ObjectId(user._id as string),
        productImage,
        status: 'pending',
      } as any);

      // Emit email notification to extrachick8@gmail.com
      emailEvent.emit('SocialOrderCreated', { order });

      return order;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new InternalServerErrorException(error);
    }
  }

  async findAll(): Promise<TypeSocialOrder[]> {
    try {
      return (await this.socialOrderRepository.findAll({
        sort: '-createdAt',
        population: [
          {
            path: 'createdByUserId',
            select: 'name email',
          },
        ],
      })) as TypeSocialOrder[];
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
  }

  async findMyOrders(user: TypeUser): Promise<TypeSocialOrder[]> {
    try {
      return this.socialOrderRepository.findByUserId(
        new Types.ObjectId(user._id as string),
      );
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
  }

  async findById(id: string): Promise<TypeSocialOrder | null> {
    try {
      return this.socialOrderRepository.findOne(
        { _id: new Types.ObjectId(id) },
        undefined,
        undefined,
        [{ path: 'createdByUserId', select: 'name email' }],
      );
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
  }

  async updateStatus(
    id: string,
    status: 'confirmed' | 'cancelled',
  ): Promise<TypeSocialOrder> {
    try {
      const order = await this.socialOrderRepository.findOneAndUpdate(
        { _id: new Types.ObjectId(id) },
        { status },
      );
      if (!order) {
        throw new NotFoundException('Social order not found');
      }
      return order;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException(error);
    }
  }

  async getSellerStats(): Promise<{
    seller: string;
    count: number;
    confirmedCount: number;
    pendingCount: number;
    cancelledCount: number;
  }[]> {
    try {
      const raw = await this.socialOrderRepository.countBySeller();

      // Ensure all three sellers are always present
      const map = new Map(raw.map((r) => [r._id, r]));
      return SELLER_NAMES.map((name) => {
        const item = map.get(name);
        return {
          seller: name,
          count: item?.count ?? 0,
          confirmedCount: item?.confirmedCount ?? 0,
          pendingCount: item?.pendingCount ?? 0,
          cancelledCount: item?.cancelledCount ?? 0,
        };
      });
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
  }
}


