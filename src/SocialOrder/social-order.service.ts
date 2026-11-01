import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { TypeUser } from 'src/DB/models/User/user.model';
import { UserRepository } from 'src/DB/models/User/user.repository';
import { CloudService } from 'src/common/service/cloud.service';
import { emailEvent } from 'src/common/Utility/email.event';
import { CreateSocialOrderDto } from './dto/create-social-order.dto';
import { SocialOrderRepository } from './social-order.repository';
import { TypeSocialOrder, SocialProduct } from './social-order.model';
import { FlextockService } from 'src/Flextock/flextock.service';

const SELLER_NAMES = ['Fatma', 'Mariam', 'Zeinab', 'Sara'] as const;

@Injectable()
export class SocialOrderService {
  private readonly logger = new Logger(SocialOrderService.name);

  constructor(
    private readonly socialOrderRepository: SocialOrderRepository,
    private readonly cloudService: CloudService,
    private readonly flextockService: FlextockService,
    private readonly userRepository: UserRepository,
  ) {}

  private parseProducts(rawProducts: any): any[] {
    if (!rawProducts) return [];
    if (Array.isArray(rawProducts)) return rawProducts;
    if (typeof rawProducts === 'string') {
      try {
        const parsed = JSON.parse(rawProducts);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  async create(
    dto: CreateSocialOrderDto,
    user: TypeUser,
    files: Express.Multer.File[] = [],
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

      // ── Upload deposit image if attached ──────────────────────────────────
      const depositFile = files.find((f) => f.fieldname === 'depositImage');
      let depositImage: { secure_url: string; public_id: string } | undefined;
      if (depositFile) {
        const uploaded = await this.cloudService.uploadFile({ path: depositFile.path });
        depositImage = {
          secure_url: uploaded.secure_url,
          public_id: uploaded.public_id,
        };
      }

      // ── Process products (multi-product array or fallback flat fields) ────
      let rawProducts = this.parseProducts(dto.products);
      const processedProducts: SocialProduct[] = [];

      if (rawProducts.length > 0) {
        for (let i = 0; i < rawProducts.length; i++) {
          const item = rawProducts[i];
          const pFile = files.find(
            (f) => f.fieldname === `productImage_${i}` || (i === 0 && f.fieldname === 'productImage'),
          );

          let prodImg = item.productImage;
          if (pFile) {
            const uploaded = await this.cloudService.uploadFile({ path: pFile.path });
            prodImg = {
              secure_url: uploaded.secure_url,
              public_id: uploaded.public_id,
            };
          }

          const variants = Array.isArray(item.variants) && item.variants.length > 0
            ? item.variants.map((v: any) => ({
                color: v.color || '',
                size: v.size || '',
                quantity: Number(v.quantity) || 1,
              }))
            : [{ color: item.color || '', size: item.size || '', quantity: Number(item.quantity) || 1 }];

          processedProducts.push({
            productName: item.productName || 'Product',
            productImage: prodImg,
            price: Number(item.price) || 0,
            productNotes: item.productNotes || '',
            variants,
          });
        }
      } else if (dto.productName) {
        // Fallback for legacy single-product creation
        const pFile = files.find((f) => f.fieldname === 'productImage');
        let legacyProductImage: { secure_url: string; public_id: string } | undefined;
        if (pFile) {
          const uploaded = await this.cloudService.uploadFile({ path: pFile.path });
          legacyProductImage = {
            secure_url: uploaded.secure_url,
            public_id: uploaded.public_id,
          };
        }

        processedProducts.push({
          productName: dto.productName,
          productImage: legacyProductImage,
          price: Number(dto.price) || 0,
          productNotes: dto.productNotes || '',
          variants: [
            {
              color: dto.color || '',
              size: dto.size || '',
              quantity: Number(dto.quantity) || 1,
            },
          ],
        });
      }

      // Legacy flat fields mapping for backward compatibility
      const primaryProduct = processedProducts[0];
      const totalQuantity = processedProducts.reduce(
        (sum, p) => sum + (p.variants || []).reduce((s, v) => s + (Number(v.quantity) || 0), 0),
        0,
      );

      const order = await this.socialOrderRepository.create({
        createdBy: dto.createdBy,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        customerAddress: dto.customerAddress,
        city: dto.city,
        deliveryNotes: dto.deliveryNotes,
        deposit: dto.deposit ? Number(dto.deposit) : 0,
        depositImage,
        products: processedProducts,
        // Legacy fields for backward compatibility
        productName: primaryProduct?.productName || dto.productName || 'Product',
        price: primaryProduct?.price ?? (dto.price ? Number(dto.price) : 0),
        quantity: totalQuantity > 0 ? totalQuantity : (dto.quantity ? Number(dto.quantity) : 1),
        color: primaryProduct?.variants?.[0]?.color || dto.color || '',
        size: primaryProduct?.variants?.[0]?.size || dto.size || '',
        productNotes: primaryProduct?.productNotes || dto.productNotes || '',
        productImage: primaryProduct?.productImage,
        createdByUserId: new Types.ObjectId((user._id as any).toString()),
        status: 'pending',
        editHistory: [],
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
        new Types.ObjectId((user._id as any).toString()),
        user.name,
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

      // Populate createdBy user for name if needed
      let populatedOrder: any = typeof (order as any).toObject === 'function' ? (order as any).toObject() : { ...order };
      if (order.createdByUserId) {
        const userIdStr = (order.createdByUserId as any)?._id
          ? (order.createdByUserId as any)._id.toString()
          : order.createdByUserId.toString();
        try {
          const user = await this.userRepository.findOne({ _id: new Types.ObjectId(userIdStr) });
          if (user) {
            populatedOrder.createdByUserId = user;
          }
        } catch {
          // fallback
        }
      }

      const flextockOrderCode = await this.flextockService.submitOrder(populatedOrder);

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

      // ── "Already exists" recovery ──────────────────────────────────────────
      // The order_code is deterministic (EXC-{mongoId}). If Flextock says the
      // code already exists, a previous attempt actually went through. Mark it
      // as submitted so the admin is not stuck in a retry loop.
      const alreadyExists = /already exists/i.test(message) || /duplicate/i.test(message);
      if (alreadyExists) {
        this.logger.warn(
          `Order ${id}: Flextock reports order_code already exists — marking as submitted.`,
        );
        const inferredCode = `EXC-${id}`;
        await this.socialOrderRepository.findOneAndUpdate(
          { _id: order._id },
          {
            $set: {
              'flextockSubmission.status': 'submitted',
              'flextockSubmission.submittedAt': new Date(),
              'flextockSubmission.flextockOrderCode': inferredCode,
              'flextockSubmission.lastError': null,
              'flextockSubmission.attempts': currentAttempts,
            },
          },
        );
        return;
      }

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
  async retryFlextock(id: Types.ObjectId | string): Promise<TypeSocialOrder> {
    try {
      const orderId = new Types.ObjectId(id.toString());
      const order = await this.socialOrderRepository.findOne({ _id: orderId });
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

      const refreshed = await this.socialOrderRepository.findOne({ _id: orderId });
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
  async syncFlextockStatus(id: Types.ObjectId | string): Promise<TypeSocialOrder> {
    try {
      const orderId = new Types.ObjectId(id.toString());
      const order = await this.socialOrderRepository.findOne({ _id: orderId });
      if (!order) throw new NotFoundException('Social order not found');

      const flextockCode = (order as any).flextockSubmission?.flextockOrderCode || `EXC-${orderId.toString()}`;

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
        { _id: orderId },
        {
          $set: {
            'flextockSubmission.status': 'submitted',
            'flextockSubmission.flextockOrderCode': flextockCode,
            'flextockSubmission.lastError': null,
            'flextockSubmission.lastStatusNote': updatedNote,
            'flextockSubmission.lastSyncedAt': new Date(),
          },
        },
      );

      const refreshed = await this.socialOrderRepository.findOne({ _id: orderId });
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
  async bulkSubmitFlextock(orderIds: (Types.ObjectId | string)[]): Promise<{ id: string; status: 'submitted' | 'failed' | 'skipped'; error?: string }[]> {
    const results: { id: string; status: 'submitted' | 'failed' | 'skipped'; error?: string }[] = [];
    for (const rawId of orderIds) {
      const id = rawId.toString();
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
    files: Express.Multer.File[] = [],
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

      checkField('customerName', 'Customer Name');
      checkField('customerPhone', 'Phone');
      checkField('customerAddress', 'Address');
      checkField('city', 'City');
      checkField('deliveryNotes', 'Delivery Notes');
      checkField('deposit', 'Deposit Amount');

      let depositImage = order.depositImage;
      const depositFile = files.find((f) => f.fieldname === 'depositImage');
      if (depositFile) {
        const uploaded = await this.cloudService.uploadFile({ path: depositFile.path });
        depositImage = {
          secure_url: uploaded.secure_url,
          public_id: uploaded.public_id,
        };
        changes.push('Deposit Image updated');
        previousState['depositImage'] = order.depositImage;
      }

      // Check products
      let updatedProducts = (order as any).products;
      if (dto.products !== undefined) {
        const rawProducts = this.parseProducts(dto.products);
        if (rawProducts.length > 0) {
          const newProducts: SocialProduct[] = [];
          for (let i = 0; i < rawProducts.length; i++) {
            const item = rawProducts[i];
            const pFile = files.find(
              (f) => f.fieldname === `productImage_${i}` || (i === 0 && f.fieldname === 'productImage'),
            );

            let prodImg = item.productImage;
            if (pFile) {
              const uploaded = await this.cloudService.uploadFile({ path: pFile.path });
              prodImg = {
                secure_url: uploaded.secure_url,
                public_id: uploaded.public_id,
              };
            }

            const variants = Array.isArray(item.variants) && item.variants.length > 0
              ? item.variants.map((v: any) => ({
                  color: v.color || '',
                  size: v.size || '',
                  quantity: Number(v.quantity) || 1,
                }))
              : [{ color: item.color || '', size: item.size || '', quantity: Number(item.quantity) || 1 }];

            newProducts.push({
              productName: item.productName || 'Product',
              productImage: prodImg,
              price: Number(item.price) || 0,
              productNotes: item.productNotes || '',
              variants,
            });
          }
          previousState['products'] = (order as any).products;
          changes.push(`Products updated (${newProducts.length} items)`);
          updatedProducts = newProducts;
        }
      }

      // Legacy direct edits
      checkField('productName', 'Product Name');
      checkField('price', 'Price');
      checkField('color', 'Color');
      checkField('size', 'Size');
      checkField('quantity', 'Quantity');
      checkField('productNotes', 'Product Notes');

      const summary = changes.length > 0 ? changes.join(' | ') : 'Order updated';

      const historyEntry = {
        editedBy: user.name || user.email,
        editedByUserId: new Types.ObjectId((user._id as any).toString()),
        editedAt: new Date(),
        summary,
        previousState,
      };

      const updatedFields: any = {
        status: 'pending', // Reset status to pending so SuperAdmin can re-confirm
      };
      if (dto.customerName !== undefined) updatedFields.customerName = dto.customerName;
      if (dto.customerPhone !== undefined) updatedFields.customerPhone = dto.customerPhone;
      if (dto.customerAddress !== undefined) updatedFields.customerAddress = dto.customerAddress;
      if (dto.city !== undefined) updatedFields.city = dto.city;
      if (dto.deliveryNotes !== undefined) updatedFields.deliveryNotes = dto.deliveryNotes;
      if (dto.deposit !== undefined) updatedFields.deposit = Number(dto.deposit);
      if (depositImage) updatedFields.depositImage = depositImage;

      if (updatedProducts && updatedProducts.length > 0) {
        updatedFields.products = updatedProducts;
        const primaryProduct = updatedProducts[0];
        const totalQuantity = updatedProducts.reduce(
          (sum: number, p: any) => sum + (p.variants || []).reduce((s: number, v: any) => s + (Number(v.quantity) || 0), 0),
          0,
        );
        updatedFields.productName = primaryProduct.productName;
        updatedFields.price = primaryProduct.price;
        updatedFields.quantity = totalQuantity;
        if (primaryProduct.productImage) updatedFields.productImage = primaryProduct.productImage;
        if (primaryProduct.variants?.[0]?.color) updatedFields.color = primaryProduct.variants[0].color;
        if (primaryProduct.variants?.[0]?.size) updatedFields.size = primaryProduct.variants[0].size;
        if (primaryProduct.productNotes) updatedFields.productNotes = primaryProduct.productNotes;
      } else {
        if (dto.productName !== undefined) updatedFields.productName = dto.productName;
        if (dto.price !== undefined) updatedFields.price = Number(dto.price);
        if (dto.quantity !== undefined) updatedFields.quantity = Number(dto.quantity);
        if (dto.color !== undefined) updatedFields.color = dto.color;
        if (dto.size !== undefined) updatedFields.size = dto.size;
        if (dto.productNotes !== undefined) updatedFields.productNotes = dto.productNotes;
      }

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

      // Ensure all sellers are always present
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
