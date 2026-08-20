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