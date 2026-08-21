/* eslint-disable @typescript-eslint/no-misused-promises */
import { EventEmitter } from "events";
import { sendEmail } from "./sendEmail";
import { orderEmailTemplate } from "./orderEmailTemplate";
import { orderStatusTemplate } from "./orderStatusTemplate";
import { orderEmailTemplateAdmin } from "./orderEmailTemplateAdmin";


export const emailEvent = new EventEmitter()

emailEvent.on("sendEmail", async (data) => {
    const { email, code } = data
    await sendEmail({ to: email, subject: 'Confirm Email', html: `<h1>Welcome to Ecommerce, please confirm your code : ${code}</h1>` })
})

emailEvent.on("resetPassword", async (data) => {
    const { email, code } = data
    await sendEmail({ to: email, subject: 'Reset Password', html: `<h1>please confirm your code : ${code}</h1>` })
})

emailEvent.on("CreateOrder", async (data) => {
    const { email, order, userName } = data
    
    const html = orderEmailTemplate(userName, order._id, order.finalPrice)
    await sendEmail({ to: email, subject: 'Order Created Successfully', html:html })
})


emailEvent.on("CreateOrderAdmin", async (data) => {
    const { email, order, userName, customerEmail, phone, address, products } = data
    
    const html = orderEmailTemplateAdmin(userName, customerEmail, order._id, order.finalPrice, order.paymentWay, order.status, phone, address, products)
    await sendEmail({ to: email, subject: '🛍️ New Order Received - Extra Chic', html:html })
})

emailEvent.on("OrderStatus", async (data) => {
    const { email, order, userName } = data
    const html = orderStatusTemplate(userName, order._id, order.status)
    await sendEmail({ to: email, subject: 'Order Status', html:html })
})

emailEvent.on("support", async (data) => {
    const { email, message, phone, name } = data
    await sendEmail({
        to: email, subject: 'Support', html: 
        `<p><strong>Name:</strong> ${name}</p>
                <p><strong>Phone:</strong> ${phone}</p>
                <p><strong>Message:</strong></p>
                <p>${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`
    })
})

emailEvent.on("SocialOrderCreated", async (data) => {
    const { order } = data
    const recipient = process.env.SUPPORT_EMAIL || "extrachick8@gmail.com"
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
        <h2 style="color: #6b21a8; margin-top: 0;">🛍️ New Social Media Order Received</h2>
        <p style="font-size: 14px; color: #4b5563;">A new social media order was registered by <strong>${order.createdBy}</strong>.</p>
        <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 16px 0;" />
        
        <h3 style="color: #1f2937; font-size: 16px;">Product Details</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 4px 0; color: #6b7280;">Product Name:</td><td style="font-weight: 600; color: #111827;">${order.productName}</td></tr>
          <tr><td style="padding: 4px 0; color: #6b7280;">Price:</td><td style="font-weight: 600; color: #111827;">${order.price} EGP</td></tr>
          <tr><td style="padding: 4px 0; color: #6b7280;">Quantity:</td><td style="font-weight: 600; color: #111827;">${order.quantity}</td></tr>
          ${order.color ? `<tr><td style="padding: 4px 0; color: #6b7280;">Color:</td><td style="font-weight: 600; color: #111827;">${order.color}</td></tr>` : ''}
          ${order.size ? `<tr><td style="padding: 4px 0; color: #6b7280;">Size:</td><td style="font-weight: 600; color: #111827;">${order.size}</td></tr>` : ''}
          ${order.productNotes ? `<tr><td style="padding: 4px 0; color: #6b7280;">Product Notes:</td><td style="color: #111827;">${order.productNotes}</td></tr>` : ''}
        </table>

        <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 16px 0;" />
        <h3 style="color: #1f2937; font-size: 16px;">Customer Information</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 4px 0; color: #6b7280;">Customer Name:</td><td style="font-weight: 600; color: #111827;">${order.customerName}</td></tr>
          <tr><td style="padding: 4px 0; color: #6b7280;">Phone:</td><td style="font-weight: 600; color: #111827;">${order.customerPhone}</td></tr>
          <tr><td style="padding: 4px 0; color: #6b7280;">City / Area:</td><td style="font-weight: 600; color: #111827;">${order.city}</td></tr>
          <tr><td style="padding: 4px 0; color: #6b7280;">Address:</td><td style="font-weight: 600; color: #111827;">${order.customerAddress}</td></tr>
          ${order.deliveryNotes ? `<tr><td style="padding: 4px 0; color: #6b7280;">Delivery Notes:</td><td style="color: #111827;">${order.deliveryNotes}</td></tr>` : ''}
        </table>
      </div>
    `
    try {
      await sendEmail({ to: recipient, subject: `🛍️ New Social Order by ${order.createdBy} - ExtraChic`, html })
    } catch (err) {
      console.error('Failed to send social order email notification:', err)
    }
})