import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { TypeUser } from 'src/DB/models/User/user.model';
import { CloudService } from 'src/common/service/cloud.service';
import { emailEvent } from 'src/common/Utility/email.event';
import { CreateSocialOrderDto } from './dto/create-social-order.dto';
import { SocialOrderRepository } from './social-order.repository';
import { TypeSocialOrder } from './social-order.model';
import { FlextockService } from 'src/Flextock/flextock.service';

const SELLER_NAMES = ['Fatma', 'Mariam', 'Zeinab', 'Sara'] as const;

@Injectable()
export class SocialOrderService {
  private readonly logger = new Logger(SocialOrderService.name);

  constructor(
    private readonly socialOrderRepository: SocialOrderRepository,
    private readonly cloudService: CloudService,
    private readonly flextockService: FlextockService,
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
      const order = await this.socialOrderRepository.findOne({ _id: new Types.ObjectId(id) });
      if (!order) {
        throw new NotFoundException('Social order not found');
      }

      const updated = await this.socialOrderRepository.findOneAndUpdate(
        { _id: new Types.ObjectId(id) },
        { status },
      );
      if (!updated) {
        throw new NotFoundException('Social order not found');
      }

      // ── Submit to Flextock on confirmation (idempotent) ──────────────────
      if (status === 'confirmed') {
        const existing = (order as any).flextockSubmission;
        const alreadySubmitted = existing?.status === 'submitted';

        if (!alreadySubmitted) {
          this.submitToFlextock(updated).catch((err) =>
            this.logger.error(`Async Flextock submission failed for ${id}: ${err.message}`),
          );
        } else {
          this.logger.log(
            `Order ${id} already submitted to Flextock (code: ${existing.flextockOrderCode}). Skipping re-submission.`,
          );
        }
      }

      return updated;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException(error);
    }
  }

  // ─── Internal: submit a single order to Flextock and persist result ──────
  private async submitToFlextock(order: TypeSocialOrder): Promise<void> {
    const id = (order._id as any).toString();
    const currentAttempts = ((order as any).flextockSubmission?.attempts ?? 0) + 1;

    try {
      // Mark as in-progress (increment attempt counter)
      await this.socialOrderRepository.findOneAndUpdate(
        { _id: order._id },
        {
          $set: {
            'flextockSubmission.status': 'not_submitted',
            'flextockSubmission.attempts': currentAttempts,
            'flextockSubmission.lastError': null,
          },
        },
      );

      const flextockOrderCode = await this.flextockService.submitOrder(order);

      // Persist success
      await this.socialOrderRepository.findOneAndUpdate(
        { _id: order._id },
        {
          $set: {
            'flextockSubmission.status': 'submitted',
            'flextockSubmission.submittedAt': new Date(),
            'flextockSubmission.flextockOrderCode': flextockOrderCode,
            'flextockSubmission.lastError': null,
            'flextockSubmission.attempts': currentAttempts,
          },
        },
      );

      this.logger.log(`Order ${id} successfully submitted to Flextock as ${flextockOrderCode}`);
    } catch (err: any) {
      const message: string = err?.message ?? String(err);
      this.logger.error(`Flextock submission failed for order ${id}: ${message}`);

      // Persist failure so admin can see and retry
      await this.socialOrderRepository.findOneAndUpdate(
        { _id: order._id },
        {
          $set: {
            'flextockSubmission.status': 'failed',
            'flextockSubmission.lastError': message,
            'flextockSubmission.attempts': currentAttempts,
          },
        },
      );
    }
  }

  // ─── Retry a failed Flextock submission ──────────────────────────────────
  async retryFlextock(id: string): Promise<TypeSocialOrder> {
    try {
      const order = await this.socialOrderRepository.findOne({ _id: new Types.ObjectId(id) });
      if (!order) throw new NotFoundException('Social order not found');

      if ((order as any).status !== 'confirmed') {
        throw new InternalServerErrorException(
          'Only confirmed orders can be submitted to Flextock.',
        );
      }

      const existing = (order as any).flextockSubmission;
      if (existing?.status === 'submitted') {
        throw new InternalServerErrorException(
          `Order is already submitted to Flextock (code: ${existing.flextockOrderCode}).`,
        );
      }

      // Run synchronously so the caller can see the result immediately
      await this.submitToFlextock(order);

      const refreshed = await this.socialOrderRepository.findOne({ _id: new Types.ObjectId(id) });
      return refreshed!;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) throw error;
      throw new InternalServerErrorException(error);
    }
  }

  // ─── Sync Flextock order status (called on-demand) ────────────────────────
  async syncFlextockStatus(id: string): Promise<TypeSocialOrder> {
    try {
      const order = await this.socialOrderRepository.findOne({ _id: new Types.ObjectId(id) });
      if (!order) throw new NotFoundException('Social order not found');

      const flextockCode = (order as any).flextockSubmission?.flextockOrderCode;
      if (!flextockCode) {
        throw new InternalServerErrorException(
          'Order has not been submitted to Flextock yet.',
        );
      }

      const statusResult = await this.flextockService.getOrderStatus(flextockCode);
      if (!statusResult) {
        throw new InternalServerErrorException(
          'Could not retrieve status from Flextock.',
        );
      }

      // Store the latest Flextock status as a note on the submission record
      const updatedNote = `Flextock status: ${statusResult.order_status}` +
        (statusResult.tracking_number ? ` | Tracking: ${statusResult.tracking_number}` : '') +
        (statusResult.courier_name ? ` | Courier: ${statusResult.courier_name}` : '');

      await this.socialOrderRepository.findOneAndUpdate(
        { _id: order._id },
        {
          $set: {
            'flextockSubmission.lastError': null,
            'flextockSubmission.lastStatusNote': updatedNote,
            'flextockSubmission.lastSyncedAt': new Date(),
          },
        },
      );

      const refreshed = await this.socialOrderRepository.findOne({ _id: new Types.ObjectId(id) });
      return refreshed!;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) throw error;
      throw new InternalServerErrorException(error);
    }
  }

  // ─── Bulk Submit Social Orders to Flextock ──────────────────────────────
  async bulkSubmitFlextock(orderIds: string[]): Promise<{ id: string; status: 'submitted' | 'failed' | 'skipped'; error?: string }[]> {
    const results: { id: string; status: 'submitted' | 'failed' | 'skipped'; error?: string }[] = [];
    for (const id of orderIds) {
      try {
        const order = await this.socialOrderRepository.findOne({ _id: new Types.ObjectId(id) });
        if (!order) {
          results.push({ id, status: 'skipped', error: 'Order not found' });
          continue;
        }
        if ((order as any).flextockSubmission?.status === 'submitted') {
          results.push({ id, status: 'skipped', error: 'Already submitted' });
          continue;
        }
        await this.submitToFlextock(order);
        const updated = await this.socialOrderRepository.findOne({ _id: new Types.ObjectId(id) });
        if ((updated as any)?.flextockSubmission?.status === 'submitted') {
          results.push({ id, status: 'submitted' });
        } else {
          results.push({ id, status: 'failed', error: (updated as any)?.flextockSubmission?.lastError || 'Unknown error' });
        }
      } catch (err: any) {
        results.push({ id, status: 'failed', error: err?.message || String(err) });
      }
    }
    return results;
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


