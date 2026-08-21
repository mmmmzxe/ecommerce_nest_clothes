import { config } from 'dotenv';
import { resolve } from 'path';
import mongoose, { Schema } from 'mongoose';
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

const UserSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    role: { type: String, default: 'user' },
    favorites: { type: Array, default: [] },
  },
  { timestamps: true }
);

const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);

async function seedSellers() {
  let connected = false;
  const urlsToTry = [
    process.env.DB_URL,
    process.env.DB_URL_LOCAL,
    'mongodb://127.0.0.1:27017/ecommerce_nest_clothes',
  ].filter(Boolean) as string[];

  for (const url of urlsToTry) {
    try {
      console.log(`Connecting to database at ${url}...`);
      await mongoose.connect(url, { serverSelectionTimeoutMS: 5000 });
      // Test query to verify auth permissions
      await UserModel.findOne({});
      connected = true;
      console.log(`Successfully authenticated with database at ${url}`);
      break;
    } catch (err: any) {
      console.warn(`Connection/auth failed for ${url}: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
    }
  }

  if (!connected) {
    throw new Error('Failed to connect and authenticate with any MongoDB instance.');
  }

  for (const seller of sellers) {
    const existing = await UserModel.findOne({ email: seller.email });
    const hashedPassword = bcrypt.hashSync(seller.password, 10);

    if (existing) {
      existing.name = seller.name;
      existing.password = hashedPassword;
      existing.role = 'admin';
      existing.phone = seller.phone;
      existing.address = seller.address;
      await existing.save();
      console.log(`Updated seller account: ${seller.name} (${seller.email})`);
    } else {
      await UserModel.create({
        name: seller.name,
        email: seller.email,
        password: hashedPassword,
        role: 'admin',
        phone: seller.phone,
        address: seller.address,
        favorites: [],
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
