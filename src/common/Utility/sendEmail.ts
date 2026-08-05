/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import * as nodemailer from 'nodemailer';

export async function sendEmail (sendMailOptoitn: nodemailer.SendMailOptions){
    const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        service: "gmail",
        port: 465,
        secure: true, // true for port 465, false for other ports
        auth: {
            user: process.env.EMAIL,
            pass: process.env.PASSWORD,
        },
    });

    try {
        console.log('Verifying email transporter for', process.env.EMAIL);
        await transporter.verify();
        console.log('Email transporter verified successfully');

        const info = await transporter.sendMail({
            from: `extra chic <${process.env.EMAIL}>`, // sender address
            ...sendMailOptoitn,
        });

        console.log('Message sent: %s', info.messageId);
        return info;
    } catch (error) {
        console.error('Failed to send email to', sendMailOptoitn.to, 'error:', error);
        throw error;
    }
}