import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { Role } from 'src/common/Decorator/role.decorator';
import { AuthGuard } from 'src/common/Guards/auth.guard';
import { RoleGuard } from 'src/common/Guards/role.guard';
import { CloudInterceptor } from 'src/common/Interceptors/cloud.interceptor';
import { multerOptions } from 'src/common/Utility/multer';
import { CreateSocialOrderDto } from './dto/create-social-order.dto';
import { SocialOrderService } from './social-order.service';

@Controller('social-orders')
@UseGuards(AuthGuard, RoleGuard)
export class SocialOrderController {
  constructor(private readonly socialOrderService: SocialOrderService) {}

  /**
   * POST /social-orders
   * Both admin sellers and superAdmin can create orders.
   * File field name: "productImage"
   */
  @Post()
  @Role(['admin', 'superAdmin'])
  @UseInterceptors(
    FileInterceptor('productImage', multerOptions()),
    CloudInterceptor,
  )
  async create(
    @Body() dto: CreateSocialOrderDto,
    @Req() req: Request,
    @UploadedFile() _file: Express.Multer.File,
  ) {
    // CloudInterceptor already uploaded the file and set req.body.image
    // We pass the raw file reference so the service can handle it if needed
    const file = req['file'] as Express.Multer.File | undefined;
    const imageFromInterceptor = req.body.image as
      | { secure_url: string; public_id: string }
      | undefined;

    const order = await this.socialOrderService.create(dto, req['user'], file);

    // If the interceptor already set the image on req.body.image, patch it in
    if (imageFromInterceptor && !order.productImage) {
      (order as any).productImage = imageFromInterceptor;
    }

    return { message: 'Done', data: order };
  }

  /**
   * GET /social-orders
   * SuperAdmin only — returns ALL orders from all sellers.
   */
  @Get()
  @Role(['superAdmin'])
  async findAll() {
    try {
      const orders = await this.socialOrderService.findAll();
      return { message: 'Done', data: orders };
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
  }

  /**
   * GET /social-orders/stats
   * SuperAdmin only — returns per-seller order counts.
   */
  @Get('stats')
  @Role(['superAdmin'])
  async getStats() {
    try {
      const stats = await this.socialOrderService.getSellerStats();
      return { message: 'Done', data: stats };
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
  }

  /**
   * GET /social-orders/my-orders
   * Admin sellers only — returns only their own orders.
   */
  @Get('my-orders')
  @Role(['admin'])
  async findMyOrders(@Req() req: Request) {
    try {
      const orders = await this.socialOrderService.findMyOrders(req['user']);
      return { message: 'Done', data: orders };
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
  }

  /**
   * GET /social-orders/:id
   * Both roles can view a specific order.
   */
  @Get(':id')
  @Role(['admin', 'superAdmin'])
  async findOne(@Param('id') id: string, @Req() req: Request) {
    try {
      const order = await this.socialOrderService.findById(id);
      if (!order) throw new NotFoundException('Order not found');

      // Admin can only view their own orders
      if (
        req['user'].role === 'admin' &&
        order.createdByUserId.toString() !== req['user']._id.toString()
      ) {
        throw new NotFoundException('Order not found');
      }

      return { message: 'Done', data: order };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException(error);
    }
  }

  /**
   * PATCH /social-orders/:id/status
   * SuperAdmin only — confirm or cancel a social media order.
   */
  @Patch(':id/status')
  @Role(['superAdmin'])
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: 'confirmed' | 'cancelled',
  ) {
    try {
      if (!['confirmed', 'cancelled'].includes(status)) {
        throw new InternalServerErrorException('Status must be "confirmed" or "cancelled"');
      }
      const order = await this.socialOrderService.updateStatus(id, status);
      return { message: 'Done', data: order };
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
  }
}

