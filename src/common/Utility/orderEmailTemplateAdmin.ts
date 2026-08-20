import { Types } from "mongoose"
import { OrderStatus, PaymentWay } from "src/User/Order/order.interface"

export const orderEmailTemplateAdmin = (
    orderName: string,
    customerEmail: string,
    orderId: Types.ObjectId,
    finalPrice: number,
    paymentMethod: PaymentWay,
    status: OrderStatus,
    phone?: string,
    address?: string,
    products?: Array<{ name: string; quantity: number; unitPrice: number; finalPrice: number }>,
    ) => {

    const productsRows = products?.length
        ? products.map(p => `
            <tr>
                <td style="padding:8px 12px; border-bottom:1px solid #f2ddd0;">${p.name}</td>
                <td style="padding:8px 12px; border-bottom:1px solid #f2ddd0; text-align:center;">${p.quantity}</td>
                <td style="padding:8px 12px; border-bottom:1px solid #f2ddd0; text-align:right;">${p.unitPrice} EGP</td>
                <td style="padding:8px 12px; border-bottom:1px solid #f2ddd0; text-align:right; font-weight:bold;">${p.finalPrice} EGP</td>
            </tr>`).join('')
        : `<tr><td colspan="4" style="padding:8px 12px; color:#888;">No products listed</td></tr>`;

    const paymentLabel: Record<string, string> = {
        cash: '💵 Cash on Delivery',
        card: '💳 Credit Card (Online)',
        instapay: '📲 InstaPay',
        vodafone_cash: '📱 Vodafone Cash',
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Order Notification</title>
</head>
<body style="margin:0; padding:0; background-color:#f7ede3; font-family:Arial, sans-serif; color:#4e4241;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f7ede3; padding:30px 0;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" width="620" style="background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.05);">

          <!-- Header -->
          <tr>
            <td align="center" style="background-color:#efc2ab; padding:25px;">
              <h1 style="margin:0; color:#4e4241; font-size:22px; font-weight:bold;">🛍️ New Order Received</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px;">
              <p style="font-size:16px; margin:0 0 20px;">Hello <strong>Admin</strong>,</p>
              <p style="font-size:15px; margin:0 0 24px; color:#666;">A new order has been placed. Here are the full details:</p>

              <!-- Customer Info -->
              <table cellpadding="0" cellspacing="0" width="100%" style="background-color:#fdf6f0; border-radius:8px; border:1px solid #efc2ab; margin-bottom:20px;">
                <tr><td style="padding:14px 16px; font-size:14px; border-bottom:1px solid #f2ddd0;"><strong>Customer Name:</strong> &nbsp;${orderName}</td></tr>
                <tr><td style="padding:14px 16px; font-size:14px; border-bottom:1px solid #f2ddd0;"><strong>Customer Email:</strong> &nbsp;<a href="mailto:${customerEmail}" style="color:#c87941;">${customerEmail}</a></td></tr>
                <tr><td style="padding:14px 16px; font-size:14px; border-bottom:1px solid #f2ddd0;"><strong>Phone:</strong> &nbsp;${phone || 'N/A'}</td></tr>
                <tr><td style="padding:14px 16px; font-size:14px;"><strong>Delivery Address:</strong> &nbsp;${address || 'N/A'}</td></tr>
              </table>

              <!-- Order Info -->
              <table cellpadding="0" cellspacing="0" width="100%" style="background-color:#fdf6f0; border-radius:8px; border:1px solid #efc2ab; margin-bottom:20px;">
                <tr><td style="padding:14px 16px; font-size:14px; border-bottom:1px solid #f2ddd0;"><strong>Order ID:</strong> &nbsp;${orderId}</td></tr>
                <tr><td style="padding:14px 16px; font-size:14px; border-bottom:1px solid #f2ddd0;"><strong>Payment Method:</strong> &nbsp;${paymentLabel[paymentMethod] || paymentMethod}</td></tr>
                <tr><td style="padding:14px 16px; font-size:14px; border-bottom:1px solid #f2ddd0;"><strong>Status:</strong> &nbsp;<span style="background:#efc2ab; color:#4e4241; padding:2px 10px; border-radius:12px; font-size:13px;">${status}</span></td></tr>
                <tr><td style="padding:14px 16px; font-size:14px;"><strong>Total Amount:</strong> &nbsp;<span style="font-size:18px; font-weight:bold; color:#c87941;">${finalPrice} EGP</span></td></tr>
              </table>

              <!-- Products Table -->
              <p style="font-size:15px; font-weight:bold; margin:0 0 8px;">Order Items:</p>
              <table cellpadding="0" cellspacing="0" width="100%" style="background-color:#fdf6f0; border-radius:8px; border:1px solid #efc2ab; margin-bottom:24px; border-collapse:collapse;">
                <thead>
                  <tr style="background-color:#efc2ab;">
                    <th style="padding:10px 12px; text-align:left; font-size:13px;">Product</th>
                    <th style="padding:10px 12px; text-align:center; font-size:13px;">Qty</th>
                    <th style="padding:10px 12px; text-align:right; font-size:13px;">Unit Price</th>
                    <th style="padding:10px 12px; text-align:right; font-size:13px;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${productsRows}
                </tbody>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="background-color:#efc2ab; padding:15px; font-size:13px; color:#4e4241;">
              © Extra Chic — Admin Notification System
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}