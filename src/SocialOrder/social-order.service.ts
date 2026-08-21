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
    depositFile?: Express.Multer.File,
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

      let depositImage: { secure_url: string; public_id: string } | undefined;
      if (depositFile) {
        const uploaded = await this.cloudService.uploadFile({ path: depositFile.path });
        depositImage = {
          secure_url: uploaded.secure_url,
          public_id: uploaded.public_id,
        };
      }

      const order = await this.socialOrderRepository.create({
        ...dto,
        deposit: dto.deposit ? Number(dto.deposit) : 0,
        createdByUserId: new Types.ObjectId((user._id as any).toString()),
        productImage,
        depositImage,
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

  async updateOrder(
    id: string,
    dto: Partial<CreateSocialOrderDto>,
    user: TypeUser,
    file?: Express.Multer.File,
    depositFile?: Express.Multer.File,
  ): Promise<TypeSocialOrder> {
    try {
      const order = await this.socialOrderRepository.findOne({ _id: new Types.ObjectId(id) });
      if (!order) throw new NotFoundException('Order not found');

      // Admin sellers can only edit their own orders
      if (user.role === 'admin') {
        const creatorIdStr = (order.createdByUserId as any)?._id
          ? (order.createdByUserId as any)._id.toString()
          : order.createdByUserId?.toString();
        const sellerNameMatch =
          order.createdBy &&
          user.name &&
          order.createdBy.toLowerCase() === user.name.toLowerCase();

        if (creatorIdStr !== (user._id as any).toString() && !sellerNameMatch) {
          throw new ForbiddenException('You can only edit your own orders');
        }
      }

      // Calculate changes summary
      const changes: string[] = [];
      const previousState: Record<string, any> = {};

      const checkField = (key: string, label: string) => {
        if (dto[key] !== undefined && String(dto[key]) !== String((order as any)[key] ?? '')) {
          changes.push(`${label}: "${(order as any)[key] ?? ''}" ➔ "${dto[key]}"`);
          previousState[key] = (order as any)[key];
        }
      };

      checkField('productName', 'Product Name');
      checkField('price', 'Price');
      checkField('deposit', 'Deposit Amount');
      checkField('color', 'Color');
      checkField('size', 'Size');
      checkField('quantity', 'Quantity');
      checkField('productNotes', 'Product Notes');
      checkField('customerName', 'Customer Name');
      checkField('customerPhone', 'Phone');
      checkField('customerAddress', 'Address');
      checkField('city', 'City');
      checkField('deliveryNotes', 'Delivery Notes');

      let productImage = order.productImage;
      if (file) {
        const uploaded = await this.cloudService.uploadFile({ path: file.path });
        productImage = {
          secure_url: uploaded.secure_url,
          public_id: uploaded.public_id,
        };
        changes.push('Product Image updated');
        previousState['productImage'] = order.productImage;
      }

      let depositImage = order.depositImage;
      if (depositFile) {
        const uploaded = await this.cloudService.uploadFile({ path: depositFile.path });
        depositImage = {
          secure_url: uploaded.secure_url,
          public_id: uploaded.public_id,
        };
        changes.push('Deposit Image updated');
        previousState['depositImage'] = order.depositImage;
      }

      const summary = changes.length > 0 ? changes.join(' | ') : 'Order updated';

      const historyEntry = {
        editedBy: user.name || user.email,
        editedByUserId: new Types.ObjectId((user._id as any).toString()),
        editedAt: new Date(),
        summary,
        previousState,
      };

      const updatedFields: any = {
        ...dto,
        status: 'pending', // Reset status to pending so SuperAdmin can re-confirm
      };
      if (productImage) updatedFields.productImage = productImage;
      if (depositImage) updatedFields.depositImage = depositImage;
      if (dto.price !== undefined) updatedFields.price = Number(dto.price);
      if (dto.deposit !== undefined) updatedFields.deposit = Number(dto.deposit);
      if (dto.quantity !== undefined) updatedFields.quantity = Number(dto.quantity);

      const updated = await this.socialOrderRepository.findOneAndUpdate(
        { _id: new Types.ObjectId(id) },
        {
          $set: updatedFields,
          $push: { editHistory: historyEntry },
        },
      );

      if (!updated) throw new NotFoundException('Order not found');
      return updated;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) throw error;
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


