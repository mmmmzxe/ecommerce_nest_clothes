import { config } from 'dotenv';
import { resolve } from 'path';
import mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';

config({ path: resolve('.env') });

const databaseUrl = process.env.DB_MODE === 'local' && process.env.DB_URL_LOCAL
  ? process.env.DB_URL_LOCAL
  : (process.env.DB_URL || 'mongodb://127.0.0.1:27017/ecommerce_nest_clothes');

const sellers = [
  { name: 'Fatma', email: 'fatma@extrachic.com', password: 'Password123!', phone: '01000000001', address: 'Cairo' },
  { name: 'Mariam', email: 'mariam@extrachic.com', password: 'Password123!', phone: '01000000002', address: 'Cairo' },
  { name: 'Zeinab', email: 'zeinab@extrachic.com', password: 'Password123!', phone: '01000000003', address: 'Cairo' },
];

async function seedSellers() {
  console.log(`Connecting to database at ${databaseUrl}...`);
  try {
    await mongoose.connect(databaseUrl, { serverSelectionTimeoutMS: 5000 });
  } catch (err: any) {
    if (process.env.DB_URL && databaseUrl !== process.env.DB_URL) {
      console.log(`Failed to connect to local DB. Trying remote DB_URL...`);
      await mongoose.connect(process.env.DB_URL, { serverSelectionTimeoutMS: 5000 });
    } else {
      throw err;
    }
  }

  const UserCollection = mongoose.connection.collection('users');

  for (const seller of sellers) {
    const existing = await UserCollection.findOne({ email: seller.email });
    const hashedPassword = bcrypt.hashSync(seller.password, 10);

    if (existing) {
      await UserCollection.updateOne(
        { email: seller.email },
        {
          $set: {
            name: seller.name,
            password: hashedPassword,
            role: 'admin',
            phone: seller.phone,
            address: seller.address,
            updatedAt: new Date(),
          },
        }
      );
      console.log(`Updated seller account: ${seller.name} (${seller.email})`);
    } else {
      await UserCollection.insertOne({
        name: seller.name,
        email: seller.email,
        password: hashedPassword,
        role: 'admin',
        phone: seller.phone,
        address: seller.address,
        favorites: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`Created seller account: ${seller.name} (${seller.email})`);
    }
  }

  console.log('\n--- SELLER ACCOUNTS READY ---');
  sellers.forEach((s) => {
    console.log(`Name: ${s.name} | Email: ${s.email} | Password: ${s.password} | Role: admin`);
  });

  await mongoose.disconnect();
}

seedSellers().catch((err) => {
  console.error('Error seeding sellers:', err.message || err);
  process.exit(1);
});
